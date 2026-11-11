// Front del chat: sin dependencias ni scripts inline (CSP estricta). Todo texto del servidor se
// escapa antes de darle formato, así ningún contenido puede inyectar HTML.

const $ = (id) => document.getElementById(id)
const el = {
  mensajes: $("mensajes"),
  formulario: $("formulario"),
  entrada: $("entrada"),
  enviar: $("enviar"),
  casos: $("casos"),
  estado: $("estado-modelo"),
  nueva: $("nueva-sesion"),
  confirmacion: $("confirmacion"),
  detalle: $("confirmacion-detalle"),
  si: $("confirmar-si"),
  no: $("confirmar-no"),
  uso: $("uso"),
  dialogo: $("dialogo-clave"),
  clave: $("clave"),
}

const almacen = {
  leer(clave) {
    try {
      return localStorage.getItem(clave)
    } catch {
      return null
    }
  },
  guardar(clave, valor) {
    try {
      if (valor === null) localStorage.removeItem(clave)
      else localStorage.setItem(clave, valor)
    } catch {
      /* almacenamiento no disponible: la app sigue funcionando */
    }
  },
}

const estado = {
  sessionId: almacen.leer("rp.sessionId"),
  claveAcceso: almacen.leer("rp.clave") ?? "",
  ocupado: false,
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function pedirClave() {
  el.clave.value = ""
  el.dialogo.showModal()
  await new Promise((r) => el.dialogo.addEventListener("close", r, { once: true }))
  estado.claveAcceso = el.clave.value.trim()
  almacen.guardar("rp.clave", estado.claveAcceso)
}

async function api(ruta, opciones = {}, reintento = true) {
  const headers = { ...(opciones.headers ?? {}), ...(estado.claveAcceso ? { "x-access-key": estado.claveAcceso } : {}) }
  const r = await fetch(ruta, { ...opciones, headers })
  if (r.status === 401 && reintento) {
    await pedirClave()
    return api(ruta, opciones, false)
  }
  return r
}

async function json(ruta, opciones) {
  const r = await api(ruta, opciones)
  const cuerpo = await r.json().catch(() => ({ error: "Respuesta inválida del servidor" }))
  return { ok: r.ok, status: r.status, cuerpo }
}

// ── Formato seguro ───────────────────────────────────────────────────────────

const escapar = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

function enLinea(t) {
  return t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
}

/** Markdown mínimo (párrafos, títulos, listas, negrita, código) sobre texto ya escapado. */
function markdown(texto) {
  const lineas = escapar(texto).split("\n")
  const html = []
  let lista = null
  const cerrar = () => {
    if (lista) html.push(`</${lista}>`)
    lista = null
  }
  for (const linea of lineas) {
    const vineta = linea.match(/^\s*[-*•]\s+(.*)$/)
    const numero = linea.match(/^\s*\d+[.)]\s+(.*)$/)
    const titulo = linea.match(/^(#{1,4})\s+(.*)$/)
    if (vineta || numero) {
      const tipo = vineta ? "ul" : "ol"
      if (lista !== tipo) {
        cerrar()
        html.push(`<${tipo}>`)
        lista = tipo
      }
      html.push(`<li>${enLinea((vineta ?? numero)[1])}</li>`)
    } else if (titulo) {
      cerrar()
      html.push(`<h4>${enLinea(titulo[2])}</h4>`)
    } else if (linea.trim() === "") {
      cerrar()
    } else {
      cerrar()
      html.push(`<p>${enLinea(linea)}</p>`)
    }
  }
  cerrar()
  return html.join("")
}

const RUTA_OUT = /out\/[a-z0-9-]+\/[A-Za-z0-9._\-/]+\.(?:xlsx|pdf|md|txt)/g

function rutasEn(...textos) {
  const rutas = new Set()
  for (const t of textos) for (const m of String(t ?? "").matchAll(RUTA_OUT)) rutas.add(m[0])
  return [...rutas]
}

// ── Render ───────────────────────────────────────────────────────────────────

function crear(tag, clase, texto) {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto !== undefined) n.textContent = texto
  return n
}

function desplazar() {
  el.mensajes.scrollTop = el.mensajes.scrollHeight
}

function quitarBienvenida() {
  el.mensajes.querySelector(".bienvenida")?.remove()
}

function pintarUsuario(texto) {
  quitarBienvenida()
  el.mensajes.append(crear("div", "mensaje usuario", texto))
  desplazar()
}

function tarjetaHerramienta(llamada) {
  const d = crear("details", "herramienta")
  const s = crear("summary")
  s.append(
    crear("span", llamada.ok ? "ok" : "fallo", llamada.ok ? "✔" : "✘"),
    crear("span", "nombre", llamada.nombre),
    crear("span", "resumen", llamada.resumen),
    crear("span", "ms", `${llamada.duracionMs} ms`),
  )
  const pre = crear("pre", "", `argumentos: ${JSON.stringify(llamada.args, null, 2)}\nresultado: ${llamada.resumen}`)
  d.append(s, pre)
  return d
}

function botonDescarga(ruta) {
  const b = crear("button", "descarga", `⬇ ${ruta.split("/").slice(-1)[0]}`)
  b.type = "button"
  b.title = ruta
  b.addEventListener("click", async () => {
    const r = await api(`/api/archivos/${ruta}`)
    if (!r.ok) return alert("No se pudo descargar el archivo.")
    const url = URL.createObjectURL(await r.blob())
    const a = Object.assign(document.createElement("a"), { href: url, download: ruta.split("/").pop() })
    a.click()
    URL.revokeObjectURL(url)
  })
  return b
}

function pintarAsistente({ texto, llamadas = [], pide = false, error = null }) {
  quitarBienvenida()
  const m = crear("div", `mensaje asistente${pide ? " pide" : ""}${error ? " error" : ""}`)
  if (llamadas.length) {
    const h = crear("div", "herramientas")
    for (const l of llamadas) h.append(tarjetaHerramienta(l))
    m.append(h)
  }
  if (pide) m.append(crear("span", "sello", "⚠️ Requiere tu confirmación"))
  const cuerpo = crear("div")
  cuerpo.innerHTML = markdown(texto) // seguro: markdown() escapa todo antes de formatear
  m.append(cuerpo)
  const rutas = rutasEn(texto, ...llamadas.map((l) => l.resumen))
  if (rutas.length) {
    const d = crear("div", "descargas")
    for (const r of rutas) d.append(botonDescarga(r))
    m.append(d)
  }
  el.mensajes.append(m)
  desplazar()
}

let indicador = null
function pensando(activo) {
  indicador?.remove()
  indicador = null
  if (!activo) return
  indicador = crear("div", "pensando")
  const puntos = crear("span", "puntos")
  puntos.append(crear("span"), crear("span"), crear("span"))
  indicador.append(puntos, crear("span", "", "El agente está trabajando…"))
  el.mensajes.append(indicador)
  desplazar()
}

function mostrarConfirmacion(pendiente) {
  el.confirmacion.hidden = !pendiente
  if (pendiente) el.detalle.textContent = pendiente.detalle || `${pendiente.accion} · ${pendiente.caso}`
}

function mostrarUso(uso) {
  if (!uso) {
    el.uso.textContent = ""
    return
  }
  const total = uso.entrada + uso.salida
  el.uso.textContent = `Sesión: ${total.toLocaleString("es-CO")} de ${uso.sessionLimit.toLocaleString("es-CO")} tokens · caché ${uso.cacheLectura.toLocaleString("es-CO")}`
}

function bloquear(si) {
  estado.ocupado = si
  el.enviar.disabled = si
  el.si.disabled = si
  el.no.disabled = si
}

// ── Acciones ─────────────────────────────────────────────────────────────────

async function enviar(texto, confirm) {
  if (estado.ocupado || !texto.trim()) return
  bloquear(true)
  mostrarConfirmacion(null)
  pintarUsuario(texto)
  pensando(true)
  try {
    const cuerpo = {
      message: texto,
      ...(estado.sessionId ? { sessionId: estado.sessionId } : {}),
      ...(confirm === undefined ? {} : { confirm }),
    }
    const r = await json("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
    pensando(false)
    if (!r.ok) return pintarAsistente({ texto: r.cuerpo.error ?? `Error ${r.status}`, error: true })
    estado.sessionId = r.cuerpo.sessionId
    almacen.guardar("rp.sessionId", estado.sessionId)
    pintarAsistente({
      texto: r.cuerpo.reply,
      llamadas: r.cuerpo.toolCalls,
      pide: r.cuerpo.needsConfirmation,
      error: r.cuerpo.error,
    })
    mostrarConfirmacion(r.cuerpo.needsConfirmation ? r.cuerpo.pendingAction : null)
    mostrarUso(r.cuerpo.usage)
  } catch {
    pensando(false)
    pintarAsistente({ texto: "No hay conexión con el servidor. Intenta de nuevo.", error: true })
  } finally {
    bloquear(false)
    el.entrada.focus()
  }
}

async function restaurarSesion() {
  if (!estado.sessionId) return
  const r = await json(`/api/sessions/${encodeURIComponent(estado.sessionId)}`)
  if (!r.ok) {
    estado.sessionId = null
    almacen.guardar("rp.sessionId", null)
    return
  }
  for (const m of r.cuerpo.messages) {
    if (m.rol === "usuario") pintarUsuario(m.texto)
    else pintarAsistente({ texto: m.texto, llamadas: m.llamadas, pide: m.needsConfirmation, error: m.error })
  }
  mostrarConfirmacion(r.cuerpo.pendingAction)
  mostrarUso(r.cuerpo.usage)
}

async function cargarEstado() {
  try {
    const r = await (await fetch("/api/health")).json()
    el.estado.textContent = `${r.provider} · ${r.model}${r.llmConfigured ? "" : " · sin clave"}`
    el.estado.classList.toggle("mal", !r.llmConfigured)
  } catch {
    el.estado.textContent = "servidor no disponible"
    el.estado.classList.add("mal")
  }
}

async function cargarCasos() {
  const r = await json("/api/casos")
  el.casos.replaceChildren()
  for (const c of r.cuerpo.casos ?? []) {
    const li = crear("li")
    const b = crear("button", "caso")
    b.type = "button"
    const titulo = crear("span", "", c.cliente ?? c.caso)
    const meta = crear("span", "meta", `${c.pais ?? "?"}`)
    meta.append(crear("span", "etiqueta", c.formato ?? "?"))
    b.append(titulo, crear("span", "id", c.caso), meta)
    b.addEventListener("click", () =>
      enviar(
        `Procesa el caso "${c.caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`,
      ),
    )
    li.append(b)
    el.casos.append(li)
  }
}

el.formulario.addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = el.entrada.value
  el.entrada.value = ""
  enviar(texto)
})
el.entrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    el.formulario.requestSubmit()
  }
})
el.si.addEventListener("click", () => enviar("Sí, confirmo.", true))
el.no.addEventListener("click", () => enviar("No, cancela.", false))
el.nueva.addEventListener("click", () => {
  estado.sessionId = null
  almacen.guardar("rp.sessionId", null)
  location.reload()
})
document.addEventListener("click", (e) => {
  const origen = e.target.closest?.("[data-mensaje]")
  if (origen) enviar(origen.dataset.mensaje)
})

await cargarEstado()
await cargarCasos()
await restaurarSesion()
