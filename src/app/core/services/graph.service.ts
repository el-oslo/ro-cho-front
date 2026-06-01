import { Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Graph, Vertex, Edge, emptyGraph } from '../models/graph.models';

@Injectable({ providedIn: 'root' })
export class GraphService {
  readonly graph = signal<Graph>(emptyGraph());
  private undoStack: Graph[] = [];
  private readonly MAX_UNDO = 20;

  constructor(private snackBar: MatSnackBar) {}

  private snapshot() {
    const g = this.graph();
    this.undoStack.push(JSON.parse(JSON.stringify(g)));
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
  }

  private nextLabel(): string {
    const used = new Set(this.graph().vertices.map(v => v.label));
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const l of letters) {
      if (!used.has(l)) return l;
    }
    let n = 1;
    while (true) {
      for (const l of letters) {
        const candidate = `${l}${n}`;
        if (!used.has(candidate)) return candidate;
      }
      n++;
    }
  }

  addVertex(pos: { x: number; y: number }): Vertex {
    this.snapshot();
    const id = crypto.randomUUID();
    const vertex: Vertex = { id, label: this.nextLabel(), x: pos.x, y: pos.y };
    this.graph.update(g => ({ ...g, vertices: [...g.vertices, vertex] }));
    return vertex;
  }

  removeVertex(id: string) {
    this.snapshot();
    this.graph.update(g => ({
      ...g,
      vertices: g.vertices.filter(v => v.id !== id),
      edges: g.edges.filter(e => e.source !== id && e.target !== id),
    }));
  }

  addEdge(srcId: string, tgtId: string, weight?: number): Edge | null {
    const g = this.graph();
    const exists = g.edges.some(
      e => (e.source === srcId && e.target === tgtId) ||
           (!g.directed && e.source === tgtId && e.target === srcId)
    );
    if (exists || srcId === tgtId) return null;
    this.snapshot();
    const edge: Edge = {
      id: crypto.randomUUID(),
      source: srcId,
      target: tgtId,
      weight,
      directed: g.directed,
    };
    this.graph.update(g => ({ ...g, edges: [...g.edges, edge] }));
    return edge;
  }

  removeEdge(id: string) {
    this.snapshot();
    this.graph.update(g => ({ ...g, edges: g.edges.filter(e => e.id !== id) }));
  }

  updateVertex(id: string, patch: Partial<Vertex>) {
    this.snapshot();
    this.graph.update(g => ({
      ...g,
      vertices: g.vertices.map(v => v.id === id ? { ...v, ...patch } : v),
    }));
  }

  updateEdge(id: string, patch: Partial<Edge>) {
    this.snapshot();
    this.graph.update(g => ({
      ...g,
      edges: g.edges.map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  }

  setDirected(directed: boolean) {
    this.snapshot();
    this.graph.update(g => ({
      ...g,
      directed,
      edges: g.edges.map(e => ({ ...e, directed })),
    }));
  }

  setWeighted(weighted: boolean) {
    this.snapshot();
    this.graph.update(g => ({ ...g, weighted }));
  }

  loadGraph(g: Graph) {
    this.snapshot();
    this.graph.set(JSON.parse(JSON.stringify(g)));
  }

  reset() {
    this.snapshot();
    this.graph.set(emptyGraph());
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev) { this.graph.set(prev); return true; }
    return false;
  }

  exportJSON() {
    const json = JSON.stringify(this.graph(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph.json';
    a.click();
    URL.revokeObjectURL(url);
    this.snackBar.open('Graph exported as graph.json', 'OK', { duration: 2500 });
  }

  async importJSON(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (
        !Array.isArray(parsed.vertices) ||
        !Array.isArray(parsed.edges) ||
        typeof parsed.directed !== 'boolean' ||
        typeof parsed.weighted !== 'boolean'
      ) {
        throw new Error('Invalid shape');
      }
      this.loadGraph(parsed as Graph);
      this.snackBar.open('Graph imported successfully', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Import failed: malformed JSON', 'Dismiss', { duration: 4000 });
    }
  }
}
