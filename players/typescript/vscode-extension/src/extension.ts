import * as vscode from 'vscode';
import { RcEditorProvider } from './RcEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        RcEditorProvider.register(context)
    );
}

export function deactivate() {}
