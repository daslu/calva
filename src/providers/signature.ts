import { TextDocument, Position, Range, CancellationToken, SignatureHelp, SignatureHelpProvider, SignatureInformation } from 'vscode';
import * as util from '../utilities';
import * as infoparser from './infoparser';
import { LispTokenCursor } from '../cursor-doc/token-cursor';
import * as docMirror from '../doc-mirror';

export class CalvaSignatureHelpProvider implements SignatureHelpProvider {
    async provideSignatureHelp(document: TextDocument, position: Position, _token: CancellationToken): Promise<SignatureHelp> {
        if (util.getConnectedState()) {
            const ns = util.getNamespace(document),
                idx = document.offsetAt(position),
                symbol = this.getSymbol(document, idx);
            if (symbol) {
                const client = util.getSession(util.getFileType(document));
                if (client) {
                    await util.createNamespaceFromDocumentIfNotExists(document);
                    const res = await client.info(ns, symbol),
                        signatures = infoparser.getSignatures(res, symbol);
                    if (signatures) {
                        const help = new SignatureHelp(),
                            currentArgsRanges = this.getCurrentArgsRanges(document, idx);
                        help.signatures = signatures;
                        help.activeSignature = this.getActiveSignatureIdx(signatures, currentArgsRanges.length);
                        if (signatures[help.activeSignature].parameters !== undefined) {
                            const currentArgIdx = currentArgsRanges.findIndex(range => range.contains(position)),
                                activeSignature = signatures[help.activeSignature];
                            help.activeParameter = activeSignature.label.match(/&/) !== null ?
                                Math.min(currentArgIdx, activeSignature.parameters.length - 1) :
                                currentArgIdx;
                        }
                        return (help);
                    }
                }
            }
        }
    }

    private getActiveSignatureIdx(signatures: SignatureInformation[], currentArgsCount): number {
        const activeSignatureIdx = signatures.findIndex(signature => signature.parameters && signature.parameters.length >= currentArgsCount);
        return activeSignatureIdx !== -1 ? activeSignatureIdx : signatures.length - 1;
    }

    private getSymbol(document: TextDocument, idx: number): string {
        const cursor: LispTokenCursor = docMirror.getDocument(document).getTokenCursor(idx);
        return cursor.getFunction();
    }

    private coordsToRange(coords: [[number, number], [number, number]]): Range {
        return new Range(new Position(...coords[0]), new Position(...coords[1]));
    }

    private getPreviousRangeIndexAndFunction(document: TextDocument, idx: number) {
        const peekBehindCursor: LispTokenCursor = docMirror.getDocument(document).getTokenCursor(idx);
        peekBehindCursor.backwardFunction(1);
        const previousFunction = peekBehindCursor.getFunction(0),
            previousRanges = peekBehindCursor.rangesForSexpsInList('(').map(this.coordsToRange),
            previousRangeIndex = previousRanges.findIndex(range => range.contains(document.positionAt(idx)));
        return { previousRangeIndex, previousFunction };
    }

    private getCurrentArgsRanges(document: TextDocument, idx: number): Range[] {
        const cursor: LispTokenCursor = docMirror.getDocument(document).getTokenCursor(idx),
            allRanges = cursor.rangesForSexpsInList('(');

        // Are we in a function that gets a threaded first parameter?
        const { previousRangeIndex, previousFunction } = this.getPreviousRangeIndexAndFunction(document, idx);
        const isInThreadFirst: boolean =
            previousRangeIndex > 1 && ['->', 'some->'].includes(previousFunction) ||
            previousRangeIndex > 1 && previousRangeIndex % 2 && previousFunction === 'cond->';

        if (allRanges !== undefined) {
            return allRanges
                .slice(1 - (isInThreadFirst ? 1 : 0))
                .map(this.coordsToRange)
        }
    }
}