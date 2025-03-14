(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.Honey = factory());
})(this, (function () { 'use strict';

    /**
     * @module filters
     */

    const filters = {};

    /**
     * Ajoute un filtre pour la substitution des tokens.
     *
     * @param {string} name - Le nom du filtre.
     * @param {function} fn - La fonction de filtre.
     * @param {number} [priority=0] - La priorité d'exécution.
     * @throws {TypeError} Si le nom n'est pas une chaîne ou si fn n'est pas une fonction.
     */
    function addFilter(name, fn, priority = 0) {
        if (typeof name !== "string" || typeof fn !== "function") {
            throw new TypeError(
                "Invalid arguments: 'name' must be a string and 'fn' must be a function."
            );
        }
        filters[name] = filters[name] || [];
        filters[name].push([fn, priority]);
        filters[name].sort((a, b) => a[1] - b[1]);
    }

    /**
     * Applique un filtre sur un payload donné.
     *
     * @param {string} name - Le nom du filtre.
     * @param {*} payload - La valeur initiale.
     * @param {...*} args - Arguments additionnels pour le filtre.
     * @returns {*} Le résultat après application des filtres.
     */
    function applyFilter(name, payload, ...args) {
        return (filters[name] || []).reduce((result, [fn]) => {
            const substituted = fn(result, ...args);
            return substituted !== undefined ? substituted : "";
        }, payload);
    }

    // Filtre par défaut pour la substitution des tokens
    addFilter("token", (token, data, tag) => {
        const path = token.split(".");
        let dataLookup = data;
        for (let i = 0; i < path.length; i++) {
            if (!Object.prototype.hasOwnProperty.call(dataLookup, path[i])) {
                return "";
            }
            dataLookup = dataLookup[path[i]];
        }
        return dataLookup;
    });

    /**
     * @module utils
     */

    /**
     * Échappe une chaîne pour être utilisée dans une expression régulière.
     * @param {string} string La chaîne à échapper.
     * @returns {string} La chaîne échappée.
     */
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /**
     * Vérifie si une chaîne correspond à un tag HTML valide.
     *
     * @param {string} tagName Le nom du tag à tester.
     * @returns {boolean} true si c'est un élément valide, false sinon.
     */
    function isValidHTMLElement(tagName) {
        const el = document.createElement(tagName);
        return !(el instanceof HTMLUnknownElement);
    }

    const ud = _userdata;

    /**
     * @module store
     * @description Objet global servant de store.
     */
    const store = {
        user: {
            name: ud.username,
            logged_in: Boolean(ud.session_logged_in),
            level: ud.user_level,
            id: ud.user_id,
            posts: ud.user_posts,
            avatar: ud.avatar,
            avatar_link: ud.avatar_link,
            group_color: ud.groupcolor,
        },
    };

    const extendStore = (data) => {
        return Object.assign({ $store: store }, data);
    };

    /**
     * @module parser
     */


    let uniqueCounter = 0;
    const localContexts = new Map();

    // Cache pour la tokenisation des templates
    const tokenCache = new Map();

    /**
     * Analyse un template et le découpe en segments statiques et tokens.
     * Chaque token est représenté par un objet { type: "token", value, flag }.
     *
     * @param {string} template La chaîne du template.
     * @param {Object} settings La configuration (start, end, path).
     * @returns {Array<Object>} Le tableau des segments.
     */
    function tokenizeTemplate(template, settings) {
        // Le pattern capture un flag optionnel ("!" ou "/") suivi du token.
        const pattern = new RegExp(
            `${escapeRegex(settings.start)}\\s*([!\\/]?)\\s*(${
            settings.path
        })\\s*${escapeRegex(settings.end)}`,
            "gi"
        );
        let tokens = [];
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(template)) !== null) {
            // Ajoute le segment statique avant le token
            if (match.index > lastIndex) {
                tokens.push({
                    type: "static",
                    value: template.slice(lastIndex, match.index),
                });
            }
            // Ajoute le token, avec match[1] comme flag ("" pour ouverture, "/" pour fermeture, éventuellement "!")
            tokens.push({
                type: "token",
                flag: match[1],
                value: match[2],
            });
            lastIndex = pattern.lastIndex;
        }
        // Ajoute le reste du template s'il existe
        if (lastIndex < template.length) {
            tokens.push({
                type: "static",
                value: template.slice(lastIndex),
            });
        }
        return tokens;
    }

    /**
     * Retourne les tokens pour un template donné en utilisant le cache.
     *
     * @param {string} template Le template à tokeniser.
     * @param {Object} settings Les paramètres de configuration.
     * @returns {Array<Object>} Le tableau des tokens.
     */
    function getTokens(template, settings) {
        if (tokenCache.has(template)) {
            return tokenCache.get(template);
        }
        const tokens = tokenizeTemplate(template, settings);
        tokenCache.set(template, tokens);
        return tokens;
    }

    /**
     * Effectue la substitution sur un template en utilisant les tokens pré-analyzés,
     * et gère les blocs conditionnels et les boucles.
     *
     * @param {string} template Le template original.
     * @param {Object} data Les données pour la substitution.
     * @param {Object} settings La configuration (start, end, path).
     * @returns {string} Le template rendu.
     */
    function substitute(template, data, settings) {
        const tokens = getTokens(template, settings);
        let output = "";
        let index = 0;

        while (index < tokens.length) {
            const segment = tokens[index];
            if (segment.type === "static") {
                output += segment.value;
                index++;
            } else if (segment.type === "token") {
                // Si c'est un token de fermeture, on l'ignore
                if (segment.flag === "/") {
                    index++;
                    continue;
                }
                // Chercher le bloc correspondant (token de fermeture avec le même value)
                let innerTokens = [];
                let j = index + 1;
                let foundClosing = false;
                while (j < tokens.length) {
                    const nextSegment = tokens[j];
                    if (
                        nextSegment.type === "token" &&
                        nextSegment.flag === "/" &&
                        nextSegment.value === segment.value
                    ) {
                        foundClosing = true;
                        break;
                    }
                    innerTokens.push(nextSegment);
                    j++;
                }
                let substituted;
                try {
                    substituted = applyFilter(
                        "token",
                        segment.value,
                        data,
                        template
                    );
                } catch (e) {
                    console.warn(e.message);
                    substituted = "";
                }
                if (foundClosing) {
                    // Reconstituer le contenu du bloc à partir des innerTokens
                    const innerTemplate = innerTokens
                        .map((tok) => {
                            if (tok.type === "static") {
                                return tok.value;
                            } else {
                                return `${settings.start}${
                                tok.flag ? tok.flag : ""
                            }${tok.value}${settings.end}`;
                            }
                        })
                        .join("");

                    if (typeof substituted === "boolean") {
                        output += substituted
                            ? substitute(innerTemplate, data, settings)
                            : "";
                    } else if (typeof substituted === "object") {
                        // Cas de boucle : substitution pour chaque clé de l'objet
                        for (const key in substituted) {
                            if (substituted.hasOwnProperty(key)) {
                                // Construire les données locales pour cette itération
                                const loopData = Object.assign(
                                    {},
                                    substituted[key],
                                    {
                                        _key: key,
                                        _value: substituted[key],
                                    }
                                );
                                // Rendu du bloc pour cette itération (récursivité sur le innerTemplate)
                                let renderedBlock = substitute(
                                    innerTemplate,
                                    loopData,
                                    settings
                                ).trim();
                                // Générer un identifiant unique
                                const uniqueId = "potion_" + uniqueCounter++;
                                // Stocker le contexte local dans la Map
                                localContexts.set(uniqueId, loopData);
                                // Injecter data-potion-key dans la première balise du rendu
                                renderedBlock = renderedBlock.replace(
                                    /^\s*<([a-zA-Z0-9-]+)/,
                                    `<$1 data-potion-key="${uniqueId}"`
                                );
                                output += renderedBlock;
                            }
                        }
                    } else {
                        output += substituted;
                    }
                    index = j + 1; // Passer après le token de fermeture
                } else {
                    // Pas de bloc trouvé : substitution simple
                    output += substituted;
                    index++;
                }
            }
        }
        return output;
    }

    /**
     * Expose la Map des contextes locaux pour une utilisation externe.
     * @type {Map<string, Object>}
     */
    const localContextsMap = localContexts;

    /**
     * @module events
     */


    /**
     * Récupère le contexte local en remontant dans l'arborescence du DOM.
     *
     * @param {Element} element L'élément DOM sur lequel commencer la recherche.
     * @param {Object} defaultData Le contexte global par défaut.
     * @returns {Object} Le contexte local trouvé ou defaultData.
     */
    function getLocalContext(element, defaultData) {
        let el = element;
        while (el && el !== document.body) {
            const key = el.getAttribute("data-potion-key");
            if (key) {
                const context = localContextsMap.get(key);
                if (context !== undefined) {
                    return context;
                }
            }
            el = el.parentElement;
        }
        return defaultData;
    }

    /**
     * Convertit un argument textuel en sa valeur.
     *
     * @param {string} arg L'argument sous forme de chaîne.
     * @param {Object} data Les données à utiliser pour la résolution.
     * @returns {*} La valeur résolue.
     */
    function parseEventArgs(arg, data) {
        if (arg === "true") return true;
        if (arg === "false") return false;
        if (!isNaN(arg)) return Number(arg);
        const match = arg.match(/^["'](.*)["']$/);
        return match ? match[1] : data[arg] || arg;
    }

    /**
     * Lie les événements définis sur un élément en gérant les modifiers.
     *
     * @param {Element} element L'élément sur lequel binder les événements.
     * @param {Object} data L'objet global de données.
     */
    function bindEvents(element, data) {
        [...element.attributes]
            .filter((attr) => attr.name.startsWith("@"))
            .forEach((attr) => {
                const parts = attr.name.slice(1).split(".");
                const eventType = parts[0];
                const modifiers = parts.slice(1);
                const regex = /^(\w+)(?:\((.*)\))?$/;
                const match = attr.value.match(regex);
                if (!match) {
                    console.warn(
                        "Potion: impossible de parser l'expression de l'événement:",
                        attr.value
                    );
                    return;
                }
                const fnName = match[1];
                const argsStr = match[2] || "";
                const localData = getLocalContext(element, data);
                const args = argsStr
                    ? argsStr
                          .split(",")
                          .map((arg) => parseEventArgs(arg.trim(), localData))
                    : [];
                const callback =
                    typeof localData[fnName] === "function"
                        ? localData[fnName]
                        : typeof data[fnName] === "function"
                        ? data[fnName]
                        : null;
                if (typeof callback === "function") {
                    element.removeEventListener(
                        eventType,
                        element._boundEvents?.[eventType]
                    );
                    const handler = (event) => {
                        if (
                            modifiers.includes("self") &&
                            event.target !== event.currentTarget
                        )
                            return;
                        if (modifiers.includes("prevent")) event.preventDefault();
                        if (modifiers.includes("stop")) event.stopPropagation();
                        if (
                            modifiers.includes("stopImmediate") &&
                            event.stopImmediatePropagation
                        )
                            event.stopImmediatePropagation();
                        // Autres vérifications pour MouseEvent/KeyboardEvent...
                        const context = { ...data, ...localData };

                        callback.call(context, event, ...args);
                    };
                    element._boundEvents = {
                        ...element._boundEvents,
                        [eventType]: handler,
                    };
                    const options = {};
                    if (modifiers.includes("capture")) options.capture = true;
                    if (modifiers.includes("once")) options.once = true;
                    if (modifiers.includes("passive")) options.passive = true;
                    element.addEventListener(eventType, handler, options);
                } else {
                    console.warn(
                        `Potion: function '${fnName}' not found in local context or data.`
                    );
                }
                element.removeAttribute(attr.name);
            });
    }

    /**
     * @module dom
     */

    /**
     * Enregistre les références d'éléments dans un objet de données.
     * Les éléments doivent avoir un attribut "#ref".
     * @param {Element} container Le container du rendu.
     * @param {Object} data Les données de l'application.
     */
    function registerRefs(container, data) {
        const refs = {};
        // Recherche les éléments ayant l'attribut "#ref" dans le container
        container.querySelectorAll("[\\#ref]").forEach((el) => {
            const refName = el.getAttribute("#ref");
            if (refName) {
                refs[refName] = el;
                el.removeAttribute("#ref");
            }
        });
        data.$refs = Object.assign({}, data.$refs, refs);
    }

    /**
     * Compare deux nœuds DOM et met à jour l'ancien nœud en fonction des différences.
     *
     * @param {Node} oldNode Le nœud existant dans le DOM.
     * @param {Node} newNode Le nouveau nœud généré.
     */
    function diffNodes(oldNode, newNode) {
        if (
            oldNode.nodeType !== newNode.nodeType ||
            oldNode.nodeName !== newNode.nodeName
        ) {
            oldNode.parentNode.replaceChild(newNode.cloneNode(true), oldNode);
            return;
        }
        if (oldNode.nodeType === Node.TEXT_NODE) {
            if (oldNode.textContent !== newNode.textContent) {
                oldNode.textContent = newNode.textContent;
            }
            return;
        }
        if (oldNode.nodeType === Node.ELEMENT_NODE) {
            Array.from(newNode.attributes).forEach((attr) => {
                if (attr.name.startsWith("@") || attr.name.startsWith("#")) return;
                if (oldNode.getAttribute(attr.name) !== attr.value) {
                    oldNode.setAttribute(attr.name, attr.value);
                }
            });
            Array.from(oldNode.attributes).forEach((attr) => {
                if (attr.name.startsWith("@") || attr.name.startsWith("#")) return;
                if (!newNode.hasAttribute(attr.name)) {
                    oldNode.removeAttribute(attr.name);
                }
            });
            const oldChildren = Array.from(oldNode.childNodes);
            const newChildren = Array.from(newNode.childNodes);
            const max = Math.max(oldChildren.length, newChildren.length);
            for (let i = 0; i < max; i++) {
                if (i >= oldChildren.length) {
                    oldNode.appendChild(newChildren[i].cloneNode(true));
                } else if (i >= newChildren.length) {
                    oldNode.removeChild(oldChildren[i]);
                } else {
                    diffNodes(oldChildren[i], newChildren[i]);
                }
            }
        }
    }

    /**
     * Met à jour le DOM en comparant un HTML généré avec l'état actuel.
     *
     * @param {Element} containerElement L'élément container du rendu.
     * @param {string} newHTML Le nouveau HTML généré.
     */
    function updateDOM(containerElement, newHTML) {
        const tagName = containerElement.tagName.toLowerCase();

        const parser = new DOMParser();
        const newDoc = parser.parseFromString(
            `<${tagName}>${newHTML}</${tagName}>`,
            "text/html"
        );
        const newContainer = newDoc.body.firstChild;

        // Recopier les attributs du container existant
        [...containerElement.attributes].forEach((attr) => {
            newContainer.setAttribute(attr.name, attr.value);
        });

        diffNodes(containerElement, newContainer);
    }

    /**
     * @module reactivity
     */

    /**
     * Cache pour stocker les proxys déjà créés pour chaque objet.
     * WeakMap permet de ne pas empêcher la collecte de déchets.
     */
    const proxyCache = new WeakMap();

    /**
     * Crée un Proxy réactif profond pour observer un objet donné.
     * Optimisé en utilisant un cache pour éviter de créer plusieurs proxies pour le même objet.
     *
     * @param {Object} target L'objet à observer.
     * @param {Function} onChange Callback appelée lors d'une modification.
     * @param {number} [maxDepth=Infinity] Profondeur maximale d'observation.
     * @param {number} [currentDepth=0] (Usage interne) Profondeur actuelle.
     * @returns {Object} Le Proxy réactif.
     */
    function deepProxy(
        target,
        onChange,
        maxDepth = Infinity,
        currentDepth = 0
    ) {
        if (typeof target !== "object" || target === null) return target;
        // Si la profondeur maximale est atteinte, renvoyer l'objet sans Proxy
        if (currentDepth >= maxDepth) return target;

        // Vérifier si le Proxy existe déjà pour cet objet
        if (proxyCache.has(target)) {
            return proxyCache.get(target);
        }

        const proxy = new Proxy(target, {
            get(obj, prop) {
                const value = Reflect.get(obj, prop);
                // Proxyfier récursivement en augmentant la profondeur
                return deepProxy(value, onChange, maxDepth, currentDepth + 1);
            },
            set(obj, prop, value) {
                const oldValue = obj[prop];
                const result = Reflect.set(obj, prop, value);
                if (oldValue !== value) {
                    onChange();
                }
                return result;
            },
        });
        proxyCache.set(target, proxy);
        return proxy;
    }

    let templates = {};
    let initialized = false;

    const defaultSettings = {
        start: "[",
        end: "]",
        path: "[a-z0-9_$][\\.a-z0-9_]*",
        type: "template/potion",
        attr: "data-name",
        tag: "div",
        class: "",
    };

    let settings = { ...defaultSettings };

    if (typeof window !== "undefined") {
        // scan le dom pour les templates de type template/potion
        document
            .querySelectorAll(`template[type="${settings.type}"]`)
            .forEach((el) => {
                const templateName = el.getAttribute(settings.attr);
                templates[templateName] = el.innerHTML;
            });
    }

    /**
     * Rendu de template depuis une chaîne ou un template en cache.
     *
     * @param {string} template - La chaîne du template ou le templateName en cache.
     * @param {Object} data - Les données pour la substitution.
     * @returns {string} Le template rendu.
     */
    function Potion(template, data) {
        // Injecter $store dans les données
        data = extendStore(data);
        if (!initialized) {
            initialized = true;
            applyFilter("init", template, data);
        }
        template = applyFilter("templateBefore", template, data);
        if (!template.includes(settings.start)) {
            template = templates[template] || template;
        }
        template = applyFilter("template", template, data);
        if (template && data !== undefined) {
            template = substitute(template, data, settings);
        }
        return applyFilter("templateAfter", template, data);
    }

    /**
     * Crée un conteneur à partir d'un template HTML présent dans le DOM.
     *
     * @param {HTMLTemplateElement} templateElement - L'élément template.
     * @param {Object} data - Les données pour le rendu.
     * @returns {Element} Le conteneur créé.
     */
    function createContainerFromTemplate(templateElement, data, customSettings) {
        customSettings = { ...settings, ...customSettings };

        // Injecter $store dans les données
        data = extendStore(data);
        const renderedHTML = Potion(
            templateElement.innerHTML,
            data);
        let container;

        if (customSettings.tag && isValidHTMLElement(customSettings.tag)) {
            container = document.createElement(customSettings.tag);
        } else {
            container = document.createElement(settings.tag);
        }
        container.innerHTML = renderedHTML;

        [...templateElement.attributes].forEach((attr) => {
            if (attr.name !== "type") {
                container.setAttribute(attr.name, attr.value);
            }
        });

        if (customSettings.class) {
            container.classList.add(...customSettings.class.split(" "));
        }

        data.$root = container;

        registerRefs(container, data);

        bindEvents(container, data);
        container.querySelectorAll("*").forEach((child) => bindEvents(child, data));

        templateElement.parentNode.replaceChild(container, templateElement);
        return container;
    }

    /**
     * Rendu synchrone avec réactivité.
     *
     * @param {string} templateName - Le nom du template.
     * @param {Object} data - Les données.
     * @returns {Object} L'objet réactif.
     */
    function renderSync(templateName, data, customSettings) {
        const templateElement = document.querySelector(
            `template[data-name='${templateName}']`
        );
        if (!templateElement) {
            throw new Error(
                `Potion: template with name '${templateName}' not found`
            );
        }

        // Injecter $store dans les données
        data = extendStore(data);

        const originalTemplateContent = templateElement.innerHTML;

        // Déclare une fonction mutable pour onChange
        let onChangeCallback = () => {};

        // Crée le proxy avec un callback qui délègue à onChangeCallback
        const proxy = deepProxy(data, () => {
            onChangeCallback();
        });

        // Crée le container en passant le proxy (qui sera utilisé pour le rendu initial)
        const containerElement = createContainerFromTemplate(
            templateElement,
            proxy,
            customSettings
        );

        // Maintenant, on définit onChangeCallback pour utiliser containerElement
        onChangeCallback = () => {
            const updatedHTML = Potion(originalTemplateContent, proxy);
            updateDOM(containerElement, updatedHTML);
            bindEvents(containerElement, proxy);
            containerElement
                .querySelectorAll("*")
                .forEach((child) => bindEvents(child, proxy));
        };

        return proxy;
    }

    /**
     * La fonction principale 'potion' qui effectue un rendu ponctuel.
     *
     * @param {string} template - Le template sous forme de chaîne.
     * @param {Object} data - Les données pour le rendu.
     * @returns {string} Le template rendu.
     */
    function potion(template, data) {
        return Potion(template, data);
    }

    potion.sync = renderSync;
    potion.render = function (templateName, data, customSettings) {
        const templateElement = document.querySelector(
            `template[data-name='${templateName}']`
        );
        if (!templateElement)
            throw new Error(
                `Potion: template with name '${templateName}' not found`
            );
        return createContainerFromTemplate(templateElement, data, customSettings);
    };

    potion.addFilter = addFilter;
    potion.applyFilter = applyFilter;

    const textNodesUnder = (el) => {
        var n,
            a = [],
            walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        while ((n = walk.nextNode())) a.push(n);
        return a;
    };

    const slugify = (text) =>
        text
            .toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^\w-]+/g, "")
            .replace(/--+/g, "-");

    const get_res_id = (p) => {
        var m = p.match(/\/[tfc]([1-9][0-9]*)(p[1-9][0-9]*)?-/);
        if (!m) m = p.match(/^\/u([1-9][0-9]*)[a-z]*$/);
        if (!m) return 0;
        return +m[1];
    };

    const getBasicVariableInnerHTML = (el, arr) => {
        const obj = {};
        arr.forEach((item) => {
            const elem = el.querySelector(`var[title="${item}"]`);
            if (elem) obj[item] = elem.innerHTML;
        });
        return obj;
    };

    const get_forum_status = (str) => {
        if (str.includes("Pas de nouveaux")) return "no-new";
        if (str.includes("verrouillé")) return "lock";
        return "new";
    };

    const get_forum_subs = (el) => {
        const subs = el.querySelectorAll('[title="subs"] a[title]');
        return Array.from(subs).map((sub) => {
            const url = new URL(sub.href).pathname;
            return {
                name: sub.innerText,
                url,
                fid: `f${get_res_id(url)}`,
                description: sub.title,
            };
        });
    };

    const get_forum_lastpost = (el) => {
        const base = {
            state: "",
            title: "",
            author: {
                username: "",
                avatar: "",
                color: "",
            },
            date: "",
            url: "",
            anchor: "",
        };

        const result = { ...base };

        const lastpostUser = el.querySelector('[title="lastpost-user"]');
        if (lastpostUser) {
            const dateTextNodes = textNodesUnder(lastpostUser);
            if (dateTextNodes.length) {
                result.state = "visible";
                result.date = dateTextNodes[0].textContent || "";
                result.author.username = dateTextNodes[1]?.textContent || "";
                const usernameLink = lastpostUser.querySelector('a[href^="/u"]');
                result.author.url = usernameLink ? usernameLink.href : "";
            }
        }

        const titleElem = el.querySelector('[title="lastpost-title"]');
        if (titleElem) {
            result.title = titleElem.textContent;
            result.url = titleElem.nextSibling?.textContent || "";
        }

        const lastpostAvatar = el.querySelector('[title="lastpost-avatar"]');
        if (lastpostAvatar) {
            const img = lastpostAvatar.querySelector("img");
            if (img) result.author.avatar = img.src;
        }

        const lastpostColor = el.querySelector('span[style^="color"]');
        if (lastpostColor) {
            result.author.color = lastpostColor.style.color;
        }

        const lastpostAnchor = el.querySelector(".last-post-icon");
        if (lastpostAnchor) {
            const img = lastpostAnchor.querySelector("img");
            if (img) result.status_img = img.src;
            result.anchor = lastpostAnchor.href;
        }

        return result;
    };

    function buildForums(cat) {
        const namedVars = [
            "name",
            "description",
            "status_img",
            "url",
            "posts",
            "topics",
        ];
        const forums = [];

        cat.querySelectorAll(".for_ref").forEach((forum) => {
            const urlElem = forum.querySelector('[title="url"]');
            const url = urlElem ? urlElem.innerHTML : "";
            const ref = `f${get_res_id(url)}`;
            const statusElem = forum.querySelector('[title="status"]');
            const statusStr = statusElem ? statusElem.innerHTML : "";
            const lastpostElem = forum.querySelector('[title="lastpost"]');

            const forumObj = {
                cid: cat.dataset.ref,
                id: ref,
                status: get_forum_status(statusStr),
                lastpost: lastpostElem ? get_forum_lastpost(lastpostElem) : {},
            };

            Array.from(forum.children)
                .filter((el) => namedVars.includes(el.title))
                .forEach((el) => {
                    forumObj[el.title] = el.innerHTML;
                });

            const descriptionImg = forum.querySelector('[title="description"] img');
            forumObj.image = descriptionImg ? descriptionImg.src : "";
            forumObj.subs = get_forum_subs(forum);
            forums.push(forumObj);
        });

        return forums;
    }

    function index_box(template, template_name) {
        const data = {
            categories: [],
            category: {},
            forum: {},
        };

        template.querySelectorAll(".cat_ref").forEach((cat) => {
            const ref = cat.dataset.ref;
            const titleElem = cat.querySelector('[title="title"]');
            const title = titleElem ? titleElem.textContent : "";
            const forums = buildForums(cat);
            const catObj = {
                id: ref,
                title,
                url: `/${ref}-${slugify(title)}`,
                forums,
            };

            data.categories.push(catObj);
            data.category[ref] = catObj;
            forums.forEach((forum) => {
                data.forum[forum.fid] = forum;
            });
        });

        return data;
    }

    function extractPagination(template) {
        const paginationEl = template.querySelector('var[title="pagination"]');
        if (!paginationEl || paginationEl.children.length == 0) return null;
        const labelAnchor = paginationEl.querySelector(
            'a[href^="javascript:Pagination();"]'
        );
        let currentPage = null,
            totalPages = null;
        if (labelAnchor) {
            const strongs = labelAnchor.querySelectorAll("strong");
            if (strongs.length >= 2) {
                currentPage = strongs[0].textContent.trim();
                totalPages = strongs[1].textContent.trim();
            }
        }

        // Le conteneur des pages est généralement le dernier élément enfant (un <span>)
        const pagesContainer = paginationEl.lastElementChild;

        let prev = null;
        let next = null;

        // Identifier les flèches de navigation en recherchant les liens ayant la classe "pag-img"
        const arrowNodes = pagesContainer.querySelectorAll("a.pag-img");
        arrowNodes.forEach((arrow) => {
            const img = arrow.querySelector("img");
            if (img) {
                const altText = img.getAttribute("alt").trim();
                if (altText === "Précédent") {
                    prev = arrow.getAttribute("href");
                } else if (altText === "Suivant") {
                    next = arrow.getAttribute("href");
                }
            }
        });

        // Extraire les numéros de pages :
        // On récupère les <strong> (page active) et les <a> (pages cliquables), en ignorant les flèches
        const pageNodes = pagesContainer.querySelectorAll(
            "a:not(.pag-img), strong"
        );
        const pages = [];
        pageNodes.forEach((node) => {
            const pageNumber = node.textContent.trim();
            if (!pageNumber) return; // ignorer les nœuds vides ou les séparateurs
            if (node.tagName.toLowerCase() === "strong") {
                pages.push({
                    page: pageNumber,
                    href: null, // pas de lien pour la page active
                    active: true,
                });
            } else if (node.tagName.toLowerCase() === "a") {
                pages.push({
                    page: pageNumber,
                    href: node.getAttribute("href"),
                    active: false,
                });
            }
        });

        return {
            currentPage,
            totalPages,
            pages,
            prev,
            next,
        };
    }

    const extractContactImages = (el) => {
        const contacts = el.querySelectorAll('[title^="contact"]');
        const obj = {};
        contacts.forEach((contact) => {
            const type = contact.title;
            const link = contact.querySelector("a");
            const img = contact.querySelector("img");

            if (link && img) {
                obj[type] = {
                    link_url: link.href,
                    link_title: link.title,
                    img_url: img.src,
                    img_alt: img.alt,
                    img_element: img,
                };
            }
        });
        return obj;
    };

    const extractMember = (member) => {
        const basicVariables = [
            "avatar",
            "url",
            "username",
            "date_joined",
            "date_last",
            "posts",
        ];
        const memberObj = {
            ...getBasicVariableInnerHTML(member, basicVariables),
            ...extractContactImages(member),
        };

        return memberObj;
    };

    function memberlist_body(template) {
        const data = {
            page: {},
            pagination: extractPagination(template),
            members: [],
        };

        template.querySelectorAll(".ref_member").forEach((member) => {
            data["members"].push(extractMember(member));
        });

        return data;
    }

    const extractPost = (post) => {
        const basicVariables = ["id", "body"];

        const postObj = {
            ...getBasicVariableInnerHTML(post, basicVariables),
        };

        console.log(postObj);

        return postObj;
    };

    function viewtopic_body(template) {
        const data = {
            page: {},
            pagination: extractPagination(template),
            posts: [],
        };

        template.querySelectorAll(".ref_post").forEach((ref) => {
            data["posts"].push(extractPost(ref));
        });

        return data;
    }

    const ENABLED_TEMPLATES = ["index_box", "memberlist_body", "viewtopic_body"];

    const isTemplateSupported = (template_name) => {
        return ENABLED_TEMPLATES.includes(template_name);
    };

    var TemplateData = function (template_name) {
        let data = {};
        const element = document.querySelector(
            `.honey[data-name="${template_name}"]`
        );
        if (!element) return;

        switch (template_name) {
            case "index_box":
                data = index_box(element);
                break;
            case "memberlist_body":
                data = memberlist_body(element);
                break;
            case "viewtopic_body":
                data = viewtopic_body(element);
                break;
        }

        return data;
    };

    const DEFAULT_OPTIONS = {
        sync: true,
    };

    window.$honey = {};

    var Component = function (options) {
        this.options = { ...DEFAULT_OPTIONS, ...options };

        this.init();
    };

    Component.prototype.init = function () {
        ENABLED_TEMPLATES.forEach((template_name) => {
            const data = TemplateData(template_name);
            if (!data) return;

            if (
                typeof this.options[template_name] === "function" &&
                isTemplateSupported(template_name)
            ) {
                data = this.options[template_name](data);
            }

            window.$honey[template_name] = this.options.sync
                ? potion.sync(template_name, data)
                : potion.render(template_name, data);
            console.log(window.$honey[template_name]);
        });
    };

    Component.prototype.render = function (template, data) {};

    return Component;

}));
