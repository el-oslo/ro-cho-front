import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'app-confirm-reset-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Réinitialiser le graphe</h2>
    <mat-dialog-content>Cela effacera tous les sommets et arêtes. Êtes-vous sûr ?</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Annuler</button>
      <button mat-raised-button color="warn" [mat-dialog-close]="true">Réinitialiser</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmResetDialogComponent {}
