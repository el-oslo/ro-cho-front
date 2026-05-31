import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-weight-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, FormsModule],
  template: `
    <h2 mat-dialog-title>Edge Weight</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Weight</mat-label>
        <input matInput type="number" [(ngModel)]="weight" (keydown.enter)="confirm()">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="null">Cancel</button>
      <button mat-raised-button color="accent" (click)="confirm()">OK</button>
    </mat-dialog-actions>
  `,
})
export class WeightDialogComponent {
  weight = 1;
  constructor(private dialogRef: MatDialogRef<WeightDialogComponent>) {}
  confirm() { this.dialogRef.close(this.weight); }
}
