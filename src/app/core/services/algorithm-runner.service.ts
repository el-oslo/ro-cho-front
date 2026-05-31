import { Injectable, signal, computed } from '@angular/core';
import { AlgorithmDef, AlgorithmStep } from '../models/algorithm.models';
import { Graph } from '../models/graph.models';
import { ALGORITHM_REGISTRY } from '../algorithms/registry';

@Injectable({ providedIn: 'root' })
export class AlgorithmRunnerService {
  readonly algorithms: AlgorithmDef[] = ALGORITHM_REGISTRY;

  readonly selectedAlgorithm = signal<AlgorithmDef | null>(null);
  readonly steps = signal<AlgorithmStep[]>([]);
  readonly currentStepIndex = signal<number>(0);
  readonly isPlaying = signal<boolean>(false);
  readonly playbackSpeed = signal<number>(500);

  readonly currentStep = computed(() => this.steps()[this.currentStepIndex()] ?? null);
  readonly hasRun = computed(() => this.steps().length > 0);

  private intervalId: ReturnType<typeof setInterval> | null = null;

  selectAlgorithm(id: string) {
    const alg = this.algorithms.find(a => a.id === id) ?? null;
    this.selectedAlgorithm.set(alg);
  }

  runAlgorithm(graph: Graph, params: Record<string, unknown>) {
    const alg = this.selectedAlgorithm();
    if (!alg) return;
    const newSteps = alg.run(graph, params);
    this.steps.set(newSteps);
    this.currentStepIndex.set(0);
    this.pause();
  }

  goToStep(n: number) {
    const max = this.steps().length - 1;
    this.currentStepIndex.set(Math.max(0, Math.min(n, max)));
  }

  nextStep() {
    this.goToStep(this.currentStepIndex() + 1);
    if (this.currentStepIndex() >= this.steps().length - 1) this.pause();
  }

  prevStep() { this.goToStep(this.currentStepIndex() - 1); }

  play() {
    if (this.currentStepIndex() >= this.steps().length - 1) this.goToStep(0);
    this.isPlaying.set(true);
    this.scheduleInterval();
  }

  pause() {
    this.isPlaying.set(false);
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private scheduleInterval() {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.currentStepIndex() >= this.steps().length - 1) {
        this.pause();
        return;
      }
      this.nextStep();
    }, this.playbackSpeed());
  }

  setPlaybackSpeed(ms: number) {
    this.playbackSpeed.set(ms);
    if (this.isPlaying()) this.scheduleInterval();
  }

  reset() {
    this.pause();
    this.steps.set([]);
    this.currentStepIndex.set(0);
  }
}
