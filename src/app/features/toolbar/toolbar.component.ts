import { Component, inject, output, input, ElementRef, ViewChild } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GraphService } from '../../core/services/graph.service';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [
    MatToolbarModule, MatButtonModule, MatButtonToggleModule,
    MatSlideToggleModule, MatIconModule, MatTooltipModule, FormsModule,
  ],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);

  readonly mode = input<'edit' | 'visualise'>('edit');
  readonly darkMode = input<boolean>(true);
  readonly leftSidenavOpen = input<boolean>(true);
  readonly rightSidenavOpen = input<boolean>(true);

  readonly modeChange = output<'edit' | 'visualise'>();
  readonly darkModeChange = output<boolean>();
  readonly loadPreset = output<void>();
  readonly toggleLeftSidenav = output<void>();
  readonly toggleRightSidenav = output<void>();

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  get directed() { return this.graphService.graph().directed; }
  get weighted() { return this.graphService.graph().weighted; }

  onDirectedChange(value: string) {
    this.graphService.setDirected(value === 'directed');
  }

  onWeightedChange(checked: boolean) {
    this.graphService.setWeighted(checked);
  }

  triggerImport() {
    this.fileInput.nativeElement.value = '';
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.graphService.importJSON(file);
  }
}
