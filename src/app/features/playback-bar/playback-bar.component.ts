import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';

@Component({
  selector: 'app-playback-bar',
  standalone: true,
  imports: [
    CommonModule, MatToolbarModule, MatButtonModule, MatIconModule,
    MatSliderModule, MatFormFieldModule, MatInputModule, MatTooltipModule, FormsModule,
  ],
  templateUrl: './playback-bar.component.html',
  styleUrl: './playback-bar.component.scss',
})
export class PlaybackBarComponent {
  protected runner = inject(AlgorithmRunnerService);

  get stepIndex() { return this.runner.currentStepIndex(); }
  get totalSteps() { return this.runner.steps().length; }
  get isFirst() { return this.stepIndex <= 0; }
  get isLast() { return this.stepIndex >= this.totalSteps - 1; }
  get speed() { return this.runner.playbackSpeed(); }

  onSliderChange(value: number) { this.runner.goToStep(value); }

  onSpeedChange(value: string) {
    const ms = parseInt(value, 10);
    if (ms >= 50 && ms <= 5000) this.runner.setPlaybackSpeed(ms);
  }

  togglePlay() {
    if (this.runner.isPlaying()) this.runner.pause();
    else this.runner.play();
  }
}
