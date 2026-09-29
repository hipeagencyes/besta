/* =========================================================
   BESTA · suite interna — núcleo compartido
   Un solo sitio para: credenciales, cliente de Supabase,
   el catálogo de espacios y el conmutador de navegación.
   Lo cargan ensayos, visuales, merch, finanzas y el hub.
   ========================================================= */
(function () {
  const SUPABASE_URL = "https://vjydiddybwutbcfigtie.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqeWRpZGR5Ynd1dGJjZmlndGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjgxMDYsImV4cCI6MjA5MjcwNDEwNn0.0SHKjvATs4dyOPo1zKaq3CyG1mbgU5qb4I1vkNw5-V0";

  /* El árbol de la suite. Añadir un espacio nuevo es añadir una entrada aquí:
     el hub y el conmutador de todas las páginas se enteran solos. */
  const SPACES = [
    {
      id: "ensayos",
      name: "ensayos",
      href: "/suite/ensayos.html",
      tagline: "repertorio, setlists y directo",
      desc: "Letras, acordes, notas por instrumento, listas y el modo directo para el escenario.",
      glyph: "♫",
      status: "live"
    },
    {
      id: "visuales",
      name: "visuales",
      href: "/suite/visuales.html",
      tagline: "estudio de muro CRT",
      desc: "Monta el muro de televisores, programa los pases y exporta el vídeo del directo.",
      glyph: "▣",
      status: "live"
    },
    {
      id: "merch",
      name: "merch",
      href: "/suite/merch.html",
      tagline: "stock, reservas y ventas",
      desc: "Catálogo de productos con tallas y precio, control de stock y registro de cada venta o reserva.",
      glyph: "◈",
      status: "live"
    },
    {
      id: "rider",
      name: "rider",
      href: "/suite/rider.html",
      tagline: "rider técnico y plano de escenario",
      desc: "El documento que se manda a la sala: necesidades por músico, input list, backline y escenario, listo para PDF.",
      glyph: "▤",
      status: "live"
    },
    {
      id: "presupuestos",
      name: "presupuestos",
      href: "/suite/presupuestos.html",
      tagline: "ofertas para salas y promotores",
      desc: "Conceptos, IVA y retención calculados solos, con su número, su estado y el PDF listo para mandar.",
      glyph: "§",
      status: "live"
    },
    {
      id: "finanzas",
      name: "finanzas",
      href: "/suite/finanzas.html",
      tagline: "cachés, gastos y reparto",
      desc: "Ingresos por bolo, gastos de la banda y cuánto toca a cada uno con un resumen tipo Tricount.",
      glyph: "€",
      status: "live"
    }
  ];

  const HUB = "/suite/";
  let clientPromise = null;

  /* --------------------------------------------------------
     La base de datos no contesta.
     El plan gratuito de Supabase duerme el proyecto tras unos
     días sin uso y le quita hasta el DNS: desde fuera parece
     que el servidor no existe. Pasó el 29/09/2026 y la suite
     se quedó en "comprobando sesión…" sin decir por qué.
     -------------------------------------------------------- */
  const DB_DOWN_FIX =
    "Si el proyecto de Supabase está en pausa (el plan gratuito la aplica tras unos días sin uso), " +
    "entra en <a href=\"https://supabase.com/dashboard\" target=\"_blank\" rel=\"noopener\">supabase.com/dashboard</a> " +
    "y pulsa <b>Restore project</b>. Los datos siguen ahí; tarda un par de minutos.";
  const DB_DOWN_HTML = "<b>No hay conexión con la base de datos.</b><br>" + DB_DOWN_FIX;

  /* Un fallo de red no es un error de la app: ni la sesión caducada ni una
     tabla que falta se parecen a esto. */
  function isDbDown(err) {
    if (!err) return false;
    const msg = (err.message || err.error_description || String(err)).toLowerCase();
    return /failed to fetch|load failed|networkerror|network error|fetch failed|err_name_not_resolved|timeout|typeerror/.test(msg);
  }

  /* ¿Contesta el proyecto? Sin sesión guardada, getSession() dice "no hay
     sesión" sin tocar la red, así que la puerta pintaba el formulario y el
     fallo solo aparecía al pulsar "entrar". Esto lo pregunta de verdad. */
  async function reachable() {
    try {
      // no-cors: la respuesta viene opaca y da igual, aquí solo se pregunta
      // si hay alguien al otro lado. Con CORS normal, un dominio que no
      // devuelve cabeceras se confundiría con un servidor caído.
      await withTimeout(fetch(SUPABASE_URL + "/auth/v1/health", {
        method: "GET", mode: "no-cors", cache: "no-store"
      }), 8000);
      return true;
    } catch (_) {
      return false;   // DNS caído o sin respuesta: esto sí es estar muerto
    }
  }

  /* ¿Hay una sesión guardada en este aparato? supabase-js la deja en
     localStorage bajo sb-<proyecto>-auth-token. Si la hay, sin conexión se
     puede seguir con lo que ya está descargado. */
  function storedSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        let raw = localStorage.getItem(k);
        if (!raw) continue;
        if (raw.startsWith("base64-")) raw = atob(raw.slice(7));
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.access_token || parsed.user)) return parsed;
      }
    } catch (_) {}
    return null;
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
    ]);
  }

  /* Pantalla de "esto no va a arrancar", con su botón de reintentar.
     Trae su propio CSS porque la usan páginas que no se parecen en nada. */
  function fatal(html) {
    if (document.querySelector(".bs-fatal")) return;
    const style = document.createElement("style");
    style.textContent = `
      .bs-fatal {
        position: fixed; inset: 0; z-index: 4000; display: grid; place-items: center;
        padding: 24px; background: #050508; color: #f5f7ff;
        font-family: 'Space Grotesk', system-ui, sans-serif;
      }
      .bs-fatal-card {
        max-width: 430px; width: 100%; text-align: center;
        background: #0d0b11; border: 1px solid rgba(255,255,255,.14);
        border-radius: 16px; padding: 28px 24px;
      }
      .bs-fatal-card p { margin: 0 0 18px; font-size: 14px; line-height: 1.55; color: rgba(245,247,255,.8); }
      .bs-fatal-card b { color: #f5f7ff; }
      .bs-fatal-card a { color: #db7f4e; }
      .bs-fatal-card button {
        padding: 10px 18px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
        background: transparent; color: #f5f7ff; font: 600 13px/1 inherit; cursor: pointer;
      }
      .bs-fatal-card button:hover { border-color: #db7f4e; color: #db7f4e; }`;
    document.head.appendChild(style);

    const box = document.createElement("div");
    box.className = "bs-fatal";
    box.innerHTML = `<div class="bs-fatal-card"><p>${html}</p>
      <button type="button">reintentar</button></div>`;
    box.querySelector("button").addEventListener("click", () => location.reload());
    document.body.appendChild(box);
    document.body.style.visibility = "visible";
  }

  /* --------------------------------------------------------
     Cliente de Supabase — uno solo por pestaña.
     Varias instancias sobre el mismo localStorage se pelean
     al refrescar el token, así que todo el mundo pide este.
     -------------------------------------------------------- */
  function client() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      if (!window.supabase) {
        // Con límite: sin red y sin el CDN cacheado esto no llega nunca,
        // y una pantalla en blanco eterna encima del escenario no vale.
        await new Promise((resolve, reject) => {
          const started = Date.now();
          const t = setInterval(() => {
            if (window.supabase) { clearInterval(t); resolve(); return; }
            if (Date.now() - started > 15000) {
              clearInterval(t);
              reject(new Error("No se pudo cargar la librería de Supabase."));
            }
          }, 30);
        });
      }
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
      });
    })();
    return clientPromise;
  }

  /* --------------------------------------------------------
     Guardia de página. Sin sesión, al hub con ?next= para
     volver aquí en cuanto entre. Devuelve la sesión.
     -------------------------------------------------------- */
  async function guard() {
    const supa = await client();
    let session = null;
    try {
      const res = await withTimeout(supa.auth.getSession(), 12000);
      session = (res && res.data && res.data.session) || null;
    } catch (err) {
      // Con sesión guardada se sigue: ensayos tiene modo sin conexión y el
      // atril no puede morir en el escenario porque no se refresque un token.
      const stored = storedSession();
      if (stored) {
        banner("Sin conexión con la base de datos: ves lo último guardado en " +
               "este aparato y los cambios no se envían. " + DB_DOWN_FIX);
        return stored;
      }
      // Sin sesión no hay nada que hacer: mandar al hub sería el mismo muro.
      fatal(DB_DOWN_HTML);
      return new Promise(() => {});
    }
    if (!session) {
      // Puede no haber sesión porque el token caducó y no hay con quién
      // renovarlo. Mandar al hub sin servidor es mandar a otra pared: si el
      // aparato tiene sesión guardada, se sigue con lo que ya está bajado.
      const stored = storedSession();
      if (stored && !(await reachable())) {
        banner("Sin conexión con la base de datos: ves lo último guardado en " +
               "este aparato y los cambios no se envían. " + DB_DOWN_FIX);
        return stored;
      }
      const next = location.pathname + location.search;
      location.replace(HUB + "?next=" + encodeURIComponent(next));
      // Promesa que nunca resuelve: la página no debe seguir montándose.
      return new Promise(() => {});
    }
    supa.auth.onAuthStateChange((event, s) => {
      if (!s && event === "SIGNED_OUT") location.replace(HUB);
    });
    return session;
  }

  async function logout() {
    const supa = await client();
    await supa.auth.signOut();
    location.href = HUB;
  }

  /* Aviso de una línea arriba del todo, para las páginas que sí pueden
     seguir funcionando con datos locales pero deben avisar de que lo están. */
  function banner(html) {
    if (document.querySelector(".bs-banner")) return;
    const el = document.createElement("div");
    el.className = "bs-banner";
    el.style.cssText = "position:sticky;top:0;z-index:3500;padding:10px 16px;" +
      "background:#3a2318;border-bottom:1px solid rgba(244,211,94,.35);color:#ffe9c9;" +
      "font:500 13px/1.5 'Space Grotesk',system-ui,sans-serif;text-align:center";
    el.innerHTML = html;
    document.body.insertBefore(el, document.body.firstChild);
  }

  /* --------------------------------------------------------
     Conmutador: botón flotante que abre el árbol de espacios.
     Se inyecta con su propio CSS para no depender de los
     estilos de cada página (ensayos y visuales no se parecen).
     -------------------------------------------------------- */
  const NAV_CSS = `
  .bs-switch {
    position: fixed; left: 14px; bottom: 14px; z-index: 3000;
    width: 46px; height: 46px; border-radius: 50%;
    display: grid; place-items: center; cursor: pointer;
    background: #14121a; color: #f5f7ff;
    border: 1px solid rgba(255,255,255,0.18);
    box-shadow: 0 6px 22px rgba(0,0,0,0.45);
    font: 600 17px/1 'Space Grotesk', system-ui, sans-serif;
    padding: 0; transition: transform .15s, border-color .15s;
  }
  .bs-switch:hover { transform: scale(1.06); border-color: #db7f4e; color: #db7f4e; }
  .bs-switch[hidden] { display: none; }
  .bs-sheet {
    position: fixed; inset: 0; z-index: 3001;
    display: grid; place-items: end start; padding: 14px;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
    font-family: 'Space Grotesk', system-ui, sans-serif;
  }
  .bs-sheet[hidden] { display: none; }
  .bs-panel {
    width: min(300px, calc(100vw - 28px));
    background: #0d0b11; color: #f5f7ff;
    border: 1px solid rgba(255,255,255,0.14); border-radius: 14px;
    overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,0.6);
  }
  .bs-panel-head {
    padding: 12px 14px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
    color: rgba(245,247,255,0.5);
  }
  .bs-item {
    display: flex; align-items: center; gap: 11px; width: 100%;
    padding: 11px 14px; background: none; border: 0; cursor: pointer;
    color: inherit; text-align: left; text-decoration: none;
    font: 600 14px/1.2 inherit;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .bs-item:hover { background: rgba(255,255,255,0.06); }
  .bs-item.on { color: #db7f4e; }
  .bs-item .g {
    width: 26px; height: 26px; flex: none; border-radius: 7px;
    display: grid; place-items: center; font-size: 13px;
    background: rgba(255,255,255,0.07); color: rgba(245,247,255,0.75);
  }
  .bs-item.on .g { background: rgba(219,127,78,0.16); color: #db7f4e; }
  .bs-item .sub {
    display: block; font: 400 11px/1.3 inherit; color: rgba(245,247,255,0.45);
    margin-top: 2px;
  }
  .bs-item.soon { opacity: .55; }
  .bs-foot { display: flex; gap: 8px; padding: 10px 14px 12px; }
  .bs-foot a, .bs-foot button {
    flex: 1; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    color: rgba(245,247,255,0.75); text-decoration: none; text-align: center;
    font: 500 12px/1 inherit;
  }
  .bs-foot a:hover, .bs-foot button:hover { color: #f5f7ff; border-color: rgba(255,255,255,0.25); }
  `;

  function mountNav(opts) {
    const active = (opts && opts.active) || "";
    if (document.querySelector(".bs-switch")) return;

    const style = document.createElement("style");
    style.textContent = NAV_CSS;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "bs-switch";
    btn.type = "button";
    btn.title = "Cambiar de espacio";
    btn.setAttribute("aria-label", "Cambiar de espacio en la suite");
    btn.textContent = "⠿";

    const sheet = document.createElement("div");
    sheet.className = "bs-sheet";
    sheet.hidden = true;
    sheet.innerHTML = `
      <div class="bs-panel" role="menu">
        <div class="bs-panel-head">suite besta</div>
        <div class="bs-list"></div>
        <div class="bs-foot">
          <a href="${HUB}">inicio suite</a>
          <button type="button" class="bs-logout">salir</button>
        </div>
      </div>`;

    const list = sheet.querySelector(".bs-list");
    SPACES.forEach(space => {
      const a = document.createElement("a");
      a.className = "bs-item" + (space.id === active ? " on" : "") +
                    (space.status === "soon" ? " soon" : "");
      a.href = space.href;
      a.innerHTML = `<span class="g">${space.glyph}</span>
        <span>${space.name}<span class="sub">${space.tagline}</span></span>`;
      list.appendChild(a);
    });

    sheet.addEventListener("click", e => { if (e.target === sheet) sheet.hidden = true; });
    sheet.querySelector(".bs-logout").addEventListener("click", logout);
    btn.addEventListener("click", () => { sheet.hidden = !sheet.hidden; });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !sheet.hidden) sheet.hidden = true;
    });

    document.body.appendChild(btn);
    document.body.appendChild(sheet);
    return { button: btn, sheet };
  }

  window.BestaSuite = {
    SUPABASE_URL, SUPABASE_ANON_KEY, SPACES, HUB, DB_DOWN_HTML, DB_DOWN_FIX,
    client, guard, logout, mountNav, fatal, banner, isDbDown, withTimeout, reachable, storedSession
  };
})();
