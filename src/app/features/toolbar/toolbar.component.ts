import { Component, inject, input, output, ElementRef, ViewChild } from '@angular/core';
import { GraphService } from '../../core/services/graph.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  protected graphService = inject(GraphService);

  readonly darkMode = input<boolean>(false);
  readonly mode = input<'edit' | 'visualise'>('edit');

  readonly darkModeChange = output<boolean>();
  readonly modeChange = output<'edit' | 'visualise'>();
  readonly loadPreset = output<void>();

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  triggerImport() {
    this.fileInput.nativeElement.value = '';
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.graphService.importJSON(file);
  }
}