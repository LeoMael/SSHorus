// Pruebas de la presentación del mapa: plegar columnas largas, estado en palabras y recorte de etiquetas.
// Ejecutar: npm test -- infra/fold
import { columnKey, foldGraph, moreLabel, MORE_PREFIX } from "./fold";
import type { Health, InfraGraph, MapEdge, MapNode, NodeKind } from "./graphTypes";
import { layoutGraph } from "./layout";
import { fitText, nodeStatus, serverStatusText, nodeStatusText } from "./status";

let fails = 0;
let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  n++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    fails++;
    console.error(`FALLO: ${msg}\n  obtenido: ${sa}\n  esperado: ${sb}`);
  }
}
function ok(c: boolean, msg: string) {
  eq(c, true, msg);
}

function node(id: string, kind: NodeKind, layer: number, health: Health = "ok"): MapNode {
  return { id, server: "s", owner: "ana", kind, layer, label: id, sub: "", health, group: null, localOnly: false, details: [], nav: null };
}
function edge(from: string, to: string, label = ""): MapEdge {
  return { id: `${from}>${to}>${label}`, from, to, label, kind: "net" };
}

/** Cortafuegos → `count` puertos → un contenedor por puerto. */
function wide(count: number, badCtr = -1): InfraGraph {
  const nodes = [node("fw", "firewall", 1)];
  const edges: MapEdge[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(node(`p${i}`, "port", 2), node(`c${i}`, "container", 5, i === badCtr ? "bad" : "ok"));
    edges.push(edge("fw", `p${i}`), edge(`p${i}`, `c${i}`, "→80"));
  }
  return { servers: [{ id: "s", name: "s", os: null, host: "s", health: "ok", owners: ["ana"], elevated: true, notes: [], firewall: null }], nodes, edges };
}

// ───────── Plegar ─────────
{
  const g = wide(9);
  eq(foldGraph(g, new Set(), 8).folds.size, 0, "con limit + 1 no se pliega (no ahorra nada)");
}
{
  const g = wide(12);
  const { graph, folds } = foldGraph(g, new Set(), 8);
  const portKey = columnKey({ server: "s", owner: "ana", layer: 2 });
  const more = `${MORE_PREFIX}${portKey}`;
  eq(folds.size, 2, "se pliegan la columna de puertos y la de contenedores");
  eq(folds.get(more)?.ids, ["p8", "p9", "p10", "p11"], "quedan a la vista los primeros puertos");
  eq(graph.nodes.filter((x) => x.kind === "port").length, 9, "8 puertos + el nodo «+4»");
  eq(graph.nodes.find((x) => x.id === more)?.label, "+4 puertos", "etiqueta del nodo plegado");
  ok(graph.nodes.some((x) => x.id === "c0") && !graph.nodes.some((x) => x.id === "c9"), "los contenedores de los puertos visibles siguen a la vista");
  eq(graph.edges.filter((e) => e.from === "fw" && e.to === more).length, 1, "una sola línea del cortafuegos al nodo plegado");
  const moreCtr = `${MORE_PREFIX}${columnKey({ server: "s", owner: "ana", layer: 5 })}`;
  eq(graph.edges.filter((e) => e.from === more && e.to === moreCtr).map((e) => e.label), [""], "puertos plegados → contenedores plegados, sin repetir ni etiqueta");
  ok(graph.edges.every((e) => graph.nodes.some((x) => x.id === e.from) && graph.nodes.some((x) => x.id === e.to)), "ninguna línea queda suelta");
  eq(g.nodes.length, 25, "el grafo original no cambia");
}
{
  const { graph, folds } = foldGraph(wide(12, 11), new Set(), 8);
  const ctrFold = [...folds.values()].find((f) => f.key.endsWith("|5"));
  ok(!ctrFold?.ids.includes("c11"), "un contenedor con error no se esconde");
  ok(graph.edges.some((e) => e.to === "c11"), "y le llega la línea desde el nodo plegado");
}
{
  const key = columnKey({ server: "s", owner: "ana", layer: 2 });
  const { folds } = foldGraph(wide(12), new Set([key]), 8);
  ok(![...folds.values()].some((f) => f.key === key), "una columna desplegada no se pliega");
}
{
  const { graph } = foldGraph(wide(30), new Set());
  const l = layoutGraph(graph);
  const boxes = [...l.nodes.values()];
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  ok(!overlap, "la disposición del mapa plegado no solapa nodos");
  const more = l.nodes.get(`${MORE_PREFIX}${columnKey({ server: "s", owner: "ana", layer: 2 })}`)!;
  ok(boxes.filter((b) => b.node.kind === "port").every((b) => b.y <= more.y), "el nodo «+N» va al final de su columna");
}
eq(moreLabel(["container"]), "+1 contenedor", "singular");
eq(moreLabel(["port", "container"]), "+2 elementos", "tipos mezclados");

// ───────── Estado en palabras ─────────
eq(nodeStatusText("container", "off"), "Parado", "contenedor parado");
eq(nodeStatusText("container", "bad"), "Con error", "contenedor con error");
eq(nodeStatusText("port", "ok"), "Expuesto: se puede llegar desde fuera", "un puerto del mapa está expuesto");
eq(nodeStatusText("firewall", "warn"), "Instalado pero apagado", "cortafuegos apagado");
eq(nodeStatusText("internet", "ok"), "Bien", "texto genérico");
eq(nodeStatus({ kind: "site", health: "warn" }), { health: "warn", text: "El certificado caduca pronto" }, "sitio con aviso");
eq(serverStatusText({ health: "off" }), "sin conexión", "servidor sin conexión");
eq(serverStatusText({ health: "ok" }), "", "servidor bien: nada que decir");

// ───────── Recortar etiquetas ─────────
const mono = (s: string) => s.length * 7;
eq(fitText("corto", 100, mono), "corto", "si cabe no se toca");
eq(fitText("tienda.example.com +1", 70, mono), "tienda.ex…", "recorta con «…» dentro del ancho");
ok(mono(fitText("app-servicio-largo-12", 90, mono)) <= 90, "nunca pasa del ancho");
eq(fitText("ab cd", 28, mono), "ab…", "sin espacio antes de «…»");

console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas`);
if (fails) throw new Error("pruebas fallidas");
