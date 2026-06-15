import { Injectable, signal } from '@angular/core';
import { Graph, Vertex, Edge } from '../../core/models/graph.models';
import { AlgorithmStep, VertexState, EdgeState } from '../../core/models/algorithm.models';

export const STATE_COLORS: Record<VertexState, string> = {
  unvisited: '#c5c8cc',
  frontier:  '#4b7fa6',
  active:    '#c47a2e',
  visited:   '#147a74',
  path:      '#8b3a3a',
  rejected:  '#6b7075',
};

const STATE_COLORS_LIGHT: Record<VertexState, string> = {
  unvisited: '#545b65',
  frontier:  '#1a5590',
  active:    '#8c5218',
  visited:   '#0a4e4a',
  path:      '#621f1f',
  rejected:  '#374048',
};

export const EDGE_COLORS: Record<EdgeState, string> = {
  default:   '#c8cdd4',
  traversed: '#4b7fa6',
  path:      '#8b3a3a',
  rejected:  '#9ba3ad',
};

const EDGE_COLORS_LIGHT: Record<EdgeState, string> = {
  default:   '#6b7480',
  traversed: '#1a5590',
  path:      '#621f1f',
  rejected:  '#4e5760',
};

const VERTEX_RADIUS = 22;

@Injectable()
export class CanvasRenderService {
  readonly showGrid = signal(true);
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly darkMode = signal(true);

  private animFrame: number | null = null;
  private currentStates: { vertexStates: Record<string, VertexState>; edgeStates: Record<string, EdgeState> } | null = null;

  get bg() { return this.darkMode() ? '#111418' : '#f8f9fb'; }
  get vertexRadius() { return VERTEX_RADIUS; }

  // Live ghost line while dragging to create an edge
  readonly dragLineEnd = signal<{ x: number; y: number } | null>(null);

  render(
    svg: SVGSVGElement,
    graph: Graph,
    step: AlgorithmStep | null,
    selected: Set<string>,
    pendingSource: string | null
  ) {
    this.currentStates = step
      ? { vertexStates: step.vertexStates, edgeStates: step.edgeStates }
      : null;

    this.drawAll(svg, graph, step, selected, pendingSource);
  }

  private drawAll(
    svg: SVGSVGElement,
    graph: Graph,
    step: AlgorithmStep | null,
    selected: Set<string>,
    pendingSource: string | null
  ) {
    svg.innerHTML = '';

    const defs = this.makeDefs(svg);
    svg.appendChild(defs);

    if (this.showGrid()) this.drawGrid(svg);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${this.panX()},${this.panY()}) scale(${this.zoom()})`);
    svg.appendChild(g);

    for (const edge of graph.edges) {
      const src = graph.vertices.find(v => v.id === edge.source);
      const tgt = graph.vertices.find(v => v.id === edge.target);
      if (!src || !tgt) continue;
      const state: EdgeState = step?.edgeStates[edge.id] ?? 'default';
      g.appendChild(this.drawEdge(edge, src, tgt, state, graph.directed));
    }

    for (const vertex of graph.vertices) {
      const state: VertexState = step?.vertexStates[vertex.id] ?? 'unvisited';
      const isSel = selected.has(vertex.id);
      const isPendingSrc = vertex.id === pendingSource;
      g.appendChild(this.drawVertex(vertex, state, isSel, isPendingSrc, graph.directed));
    }

    // Ghost edge line while dragging to create a connection
    const dle = this.dragLineEnd();
    if (pendingSource && dle) {
      const src = graph.vertices.find(v => v.id === pendingSource);
      if (src) {
        const ghostLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ghostLine.setAttribute('x1', String(src.x));
        ghostLine.setAttribute('y1', String(src.y));
        ghostLine.setAttribute('x2', String(dle.x));
        ghostLine.setAttribute('y2', String(dle.y));
        ghostLine.setAttribute('stroke', '#FFD600');
        ghostLine.setAttribute('stroke-width', '2');
        ghostLine.setAttribute('stroke-dasharray', '6 3');
        ghostLine.setAttribute('opacity', '0.8');
        ghostLine.setAttribute('pointer-events', 'none');
        g.appendChild(ghostLine);
      }
    }
  }

  private makeDefs(svg: SVGSVGElement): SVGDefsElement {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    // One marker per edge state — compact triangle matching the redesign
    const edgeColors = this.darkMode() ? EDGE_COLORS : EDGE_COLORS_LIGHT;
    for (const [state, color] of Object.entries(edgeColors)) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', `edge-arrow-${state}`);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('markerWidth', '2');
      marker.setAttribute('markerHeight', '2');
      marker.setAttribute('refX', '4');
      marker.setAttribute('refY', '5');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 0 1.5 L 8 5 L 0 8.5 Z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    return defs;
  }

  private drawGrid(svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;
    const gridEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    gridEl.setAttribute('width', String(w));
    gridEl.setAttribute('height', String(h));
    gridEl.setAttribute('fill', `url(#dot-grid)`);
    const defs = svg.querySelector('defs')!;
    const pat = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pat.setAttribute('id', 'dot-grid');
    pat.setAttribute('width', '20');
    pat.setAttribute('height', '20');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '1');
    circle.setAttribute('cy', '1');
    circle.setAttribute('r', '1');
    circle.setAttribute('fill', this.darkMode() ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)');
    pat.appendChild(circle);
    defs.appendChild(pat);
    svg.insertBefore(gridEl, svg.firstChild?.nextSibling ?? null);
  }

  private drawEdge(edge: Edge, src: Vertex, tgt: Vertex, state: EdgeState, directed: boolean): SVGGElement {
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const color = (this.darkMode() ? EDGE_COLORS : EDGE_COLORS_LIGHT)[state];
    const isSelfLoop = edge.source === edge.target;

    if (isSelfLoop) {
      const loop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const r = VERTEX_RADIUS;
      const d = `M ${src.x} ${src.y - r} C ${src.x + 60} ${src.y - 80} ${src.x + 80} ${src.y + 30} ${src.x + r} ${src.y}`;
      loop.setAttribute('d', d);
      loop.setAttribute('fill', 'none');
      loop.setAttribute('stroke', color);
      loop.setAttribute('stroke-width', '2');
      grp.appendChild(loop);
      if (edge.weight !== undefined) {
        const lbl = this.makeText(src.x + 55, src.y - 45, String(edge.weight), color);
        grp.appendChild(lbl);
      }
      return grp;
    }

    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;

    const startX = src.x + ux * VERTEX_RADIUS;
    const startY = src.y + uy * VERTEX_RADIUS;
    const endX = tgt.x - ux * (VERTEX_RADIUS + (directed ? 8 : 0));
    const endY = tgt.y - uy * (VERTEX_RADIUS + (directed ? 8 : 0));

    const midX = (startX + endX) / 2 - uy * 20;
    const midY = (startY + endY) / 2 + ux * 20;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', state === 'path' ? '3' : '2');
    if (directed) {
      path.setAttribute('marker-end', `url(#edge-arrow-${state})`);
    }
    path.setAttribute('data-edge-id', edge.id);
    grp.appendChild(path);

    // Hit area (transparent, wider)
    const hit = path.cloneNode() as SVGPathElement;
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    hit.setAttribute('data-edge-id', edge.id);
    grp.insertBefore(hit, path);

    if (edge.weight !== undefined) {
      const lx = (startX + endX) / 2 - uy * 26;
      const ly = (startY + endY) / 2 + ux * 26;
      const lbl = this.makeText(lx, ly, String(edge.weight), color);
      lbl.setAttribute('data-edge-id', edge.id);
      grp.appendChild(lbl);
    }

    return grp;
  }

  private drawVertex(vertex: Vertex, state: VertexState, selected: boolean, pendingSource: boolean, _directed: boolean): SVGGElement {
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('data-vertex-id', vertex.id);
    grp.setAttribute('transform', `translate(${vertex.x}, ${vertex.y})`);
    grp.setAttribute('cursor', 'pointer');

    const fill = (this.darkMode() ? STATE_COLORS : STATE_COLORS_LIGHT)[state];

    if (selected) {
      const sel = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      sel.setAttribute('r', String(VERTEX_RADIUS + 6));
      sel.setAttribute('fill', 'rgba(255,255,255,0.25)');
      grp.appendChild(sel);
    }

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(VERTEX_RADIUS));
    circle.setAttribute('fill', fill);
    circle.setAttribute('stroke', pendingSource ? '#FFD600' : (selected ? '#fff' : 'rgba(0,0,0,0.3)'));
    circle.setAttribute('stroke-width', pendingSource ? '3' : (selected ? '2' : '1.5'));
    if (state === 'path') {
      circle.setAttribute('class', 'pulse-path');
    }
    grp.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', '#fff');
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '600');
    text.setAttribute('pointer-events', 'none');
    text.textContent = vertex.label;
    grp.appendChild(text);

    return grp;
  }

  private makeText(x: number, y: number, txt: string, fill: string): SVGTextElement {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('fill', fill);
    t.setAttribute('font-size', '16');
    t.setAttribute('font-weight', '500');
    t.textContent = txt;
    return t;
  }

  screenToWorld(svgEl: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgEl.getBoundingClientRect();
    const sx = (clientX - rect.left - this.panX()) / this.zoom();
    const sy = (clientY - rect.top - this.panY()) / this.zoom();
    return { x: sx, y: sy };
  }

  hitTestVertex(graph: Graph, wx: number, wy: number): string | null {
    for (const v of graph.vertices) {
      const d = Math.hypot(v.x - wx, v.y - wy);
      if (d <= VERTEX_RADIUS) return v.id;
    }
    return null;
  }

  hitTestEdge(graph: Graph, wx: number, wy: number): string | null {
    for (const e of graph.edges) {
      const src = graph.vertices.find(v => v.id === e.source);
      const tgt = graph.vertices.find(v => v.id === e.target);
      if (!src || !tgt) continue;
      const mx = (src.x + tgt.x) / 2;
      const my = (src.y + tgt.y) / 2;
      if (Math.hypot(mx - wx, my - wy) < 14) return e.id;
    }
    return null;
  }

  zoomIn(svgEl: SVGSVGElement) {
    this.setZoom(Math.min(this.zoom() * 1.2, 3), svgEl);
  }

  zoomOut(svgEl: SVGSVGElement) {
    this.setZoom(Math.max(this.zoom() / 1.2, 0.3), svgEl);
  }

  fitToScreen(svgEl: SVGSVGElement, graph: Graph) {
    if (!graph.vertices.length) { this.zoom.set(1); this.panX.set(0); this.panY.set(0); return; }
    const rect = svgEl.getBoundingClientRect();
    const xs = graph.vertices.map(v => v.x);
    const ys = graph.vertices.map(v => v.y);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    const scaleX = rect.width / (maxX - minX);
    const scaleY = rect.height / (maxY - minY);
    const scale = Math.min(scaleX, scaleY, 3);
    this.zoom.set(Math.max(scale, 0.3));
    this.panX.set((rect.width - (maxX + minX) * scale) / 2);
    this.panY.set((rect.height - (maxY + minY) * scale) / 2);
  }

  private setZoom(z: number, svgEl: SVGSVGElement) {
    const rect = svgEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const ratio = z / this.zoom();
    this.panX.update(px => cx - (cx - px) * ratio);
    this.panY.update(py => cy - (cy - py) * ratio);
    this.zoom.set(z);
  }
}
