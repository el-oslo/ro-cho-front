import {
  Component, inject, signal, HostListener, OnInit
} from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ToolbarComponent } from './features/toolbar/toolbar.component';
import { AlgorithmPanelComponent } from './features/algorithm-panel/algorithm-panel.component';
import { CanvasComponent } from './features/canvas/canvas.component';
import { MatrixEditorComponent } from './features/matrix-editor/matrix-editor.component';
import { PlaybackBarComponent } from './features/playback-bar/playback-bar.component';
import { OutputPanelComponent } from './features/output-panel/output-panel.component';
import { PresetLoaderComponent, PresetLoaderResult } from './shared/preset-loader/preset-loader.component';

import { GraphService } from './core/services/graph.service';
import { AlgorithmRunnerService } from './core/services/algorithm-runner.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    MatTabsModule,
    ToolbarComponent, AlgorithmPanelComponent,
    CanvasComponent, MatrixEditorComponent,
    PlaybackBarComponent, OutputPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  readonly mode = signal<'edit' | 'visualise'>('edit');
  readonly darkMode = signal<boolean>(true);
  readonly algPanelOpen = signal<boolean>(false);
  readonly outputPanelOpen = signal<boolean>(false);

  ngOnInit() {
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) this.darkMode.set(stored === 'true');
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); this.runner.nextStep(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.runner.prevStep(); }
    if (e.ctrlKey && e.key === 'z' && this.mode() === 'edit') {
      e.preventDefault();
      if (this.graphService.undo()) {
        this.snackBar.open('Undo', undefined, { duration: 1200 });
      }
    }
  }

  private togglePlay() {
    if (this.runner.isPlaying()) this.runner.pause();
    else this.runner.play();
  }

  onDarkModeChange(dark: boolean) {
    this.darkMode.set(dark);
    localStorage.setItem('darkMode', String(dark));
  }

  openPresetDialog() {
    const ref = this.dialog.open(PresetLoaderComponent, {
      data: {
        algorithms: this.runner.algorithms,
        selectedAlgId: this.runner.selectedAlgorithm()?.id ?? null,
      },
      width: '600px',
    });
    ref.afterClosed().subscribe((result: PresetLoaderResult | null) => {
      if (!result) return;
      this.graphService.loadGraph(result.preset.graph);
      this.runner.reset();
      const algId = this.runner.algorithms.find(a =>
        a.presets.some(p => p.name === result.preset.name)
      )?.id;
      if (algId) this.runner.selectAlgorithm(algId);
      this.snackBar.open(`Loaded preset: ${result.preset.name}`, 'OK', { duration: 2500 });
    });
  }
}
