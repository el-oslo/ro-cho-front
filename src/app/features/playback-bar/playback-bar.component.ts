import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';

@Component({
  selector: 'app-playback-bar',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './playback-bar.component.html',
  styleUrl: './playback-bar.component.scss',
})
export class PlaybackBarComponent {
  protected runner = inject(AlgorithmRunnerService);

  readonly speedPresets = [
    { ms: 1600, label: '0.5×' },
    { ms: 900,  label: '1×'   },
    { ms: 450,  label: '2×'   },
    { ms: 200,  label: '4×'   },
  ];

  get stepIndex()  { return this.runner.currentStepIndex(); }
  get totalSteps() { return this.runner.steps().length; }
  get isFirst()    { return this.stepIndex <= 0; }
  get isLast()     { return this.stepIndex >= this.totalSteps - 1; }
  get speed()      { return this.runner.playbackSpeed(); }

  get scrubPct() {
    return this.totalSteps > 1 ? (this.stepIndex / (this.totalSteps - 1)) * 100 : 0;
  }

  onSliderChange(value: number) { this.runner.goToStep(value); }

  setSpeed(ms: number) { this.runner.setPlaybackSpeed(ms); }

  togglePlay() {
    if (this.runner.isPlaying()) this.runner.pause();
    else this.runner.play();
  }
}
