
import {
	Diagnostic,
	DiagnosticSeverity,
	SemanticTokens,
	SemanticTokensBuilder,
	SemanticTokensLegend,
	Position
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
	ANTLRInputStream, 
	CommonTokenStream,
	ANTLRErrorListener, 
	CommonToken,
	RecognitionException, 
	Recognizer, 
	Token
} from "antlr4ts";

import { 
	ParseTreeListener
} from "antlr4ts/tree/ParseTreeListener"

import { 
	CypherLexer 
} from './antlr/CypherLexer';

import { 
	CypherParser,
	OC_LabelNameContext,
	OC_LiteralContext,
	OC_MatchContext,
	OC_PropertyKeyNameContext,
	OC_ReturnContext,
	OC_VariableContext,
	OC_WhereContext
} from './antlr/CypherParser';

import {
	CypherListener
} from './antlr/CypherListener'


const tokenTypesMap = new Map<string, number>();
const tokenModifiersMap = new Map<string, number>();

// ************************************************************
// Part of the code that does the highlighting
// ************************************************************
export class Legend implements SemanticTokensLegend {
	tokenTypes: string[] = [];
    tokenModifiers: string[] = [];

	constructor() {
		const tokenTypesLegend = [
			'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
			'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
			'method', 'decorator', 'macro', 'variable', 'parameter', 'property', 'label'
		];
		tokenTypesLegend.forEach((tokenType, index) => {
			this.tokenTypes.push(tokenType)
			tokenTypesMap.set(tokenType, index)
		});

		const tokenModifiersLegend = [
			'declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated',
			'modification', 'async'
		];
		tokenModifiersLegend.forEach((tokenModifier, index) => {
			this.tokenModifiers.push(tokenModifier)
			tokenModifiersMap.set(tokenModifier, index)
		});

	}
}

interface IParsedToken {
	line: number;
	startCharacter: number;
	length: number;
	tokenType: string;
}

export class DocumentSemanticTokensProvider implements DocumentSemanticTokensProvider {
	async provideDocumentSemanticTokens(textDocument: TextDocument): Promise<SemanticTokens> {
		const lineText: string = textDocument.getText();
		const inputStream = new ANTLRInputStream(lineText);
		const lexer = new CypherLexer(inputStream);
		const tokenStream = new CommonTokenStream(lexer);
		
		const parser = new CypherParser(tokenStream);
		
		const syntaxHighliter = new SyntaxHighlighter();
		parser.addParseListener(syntaxHighliter as ParseTreeListener);
		const tree = parser.oC_Cypher();

		const builder = new SemanticTokensBuilder();
		const sortedTokens = syntaxHighliter.allTokens.sort((a, b) => a.startCharacter - b.startCharacter)
		
		// When we push to the builder, tokens need to be sorted in ascending starting position
		// i.e. as we find them when we read them from left to right in the line
		sortedTokens.forEach((token) => {
			// Nacho: FIXME The 0 index for the token modifiers at the end is hardcoded
			const index = this._encodeTokenType(token.tokenType)
			builder.push(token.line, token.startCharacter, token.length, index, 0);
		});
		return builder.build();
	}

	private _encodeTokenType(tokenType: string): number {
		if (tokenTypesMap.has(tokenType)) {
			return tokenTypesMap.get(tokenType)!;
		}
		return 0;
	}
}

class SyntaxHighlighter implements CypherListener {
	allTokens: IParsedToken[] = []
	
	enterOC_LabelName(ctx: OC_LabelNameContext) {
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "typeParameter"
		});
	}

	enterOC_Return(ctx: OC_ReturnContext) {
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "keyword"
		});
	}
	
	exitOC_Match(ctx: OC_MatchContext) {
		const opt = ctx.OPTIONAL()
		const match = ctx.MATCH()

		if (opt) {
			const optToken = opt.symbol
			this.allTokens.push({
				line: optToken.line - 1,
				startCharacter: optToken.startIndex,
				length: optToken.stopIndex - optToken.startIndex + 1,
				tokenType: "decorator"
			});
		}

		const matchToken = match.symbol
		this.allTokens.push({
			line: matchToken.line - 1,
			startCharacter: matchToken.startIndex,
			length: matchToken.stopIndex - matchToken.startIndex + 1,
			tokenType: "method"
		});
	}

	enterOC_Variable(ctx: OC_VariableContext) {
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "variable"
		});
	}

	enterOC_Where(ctx: OC_WhereContext) {
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "keyword"
		});
	}

	enterOC_PropertyKeyName(ctx: OC_PropertyKeyNameContext) {
		// FIXME Is this correct in this case for all cases, not just simple properties?
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "property"
		});
	}

	
	enterOC_Literal(ctx: OC_LiteralContext) {
		const token = ctx.start
		this.allTokens.push({
			line: token.line - 1,
			startCharacter: token.startIndex,
			length: token.stopIndex - token.startIndex + 1,
			tokenType: "string"
		});
	}
}

// ************************************************************
// Part of the code that highlights the syntax errors
// ************************************************************
export class ErrorListener implements ANTLRErrorListener<CommonToken> {
	diagnostics: Diagnostic[];
	textDocument: TextDocument;
	
	constructor(textDocument: TextDocument) {
		this.diagnostics = [];
		this.textDocument = textDocument;
	}

    public syntaxError<T extends Token>(recognizer: Recognizer<T, any>, offendingSymbol: T | undefined, line: number,
        charPositionInLine: number, msg: string, e: RecognitionException | undefined): void {
			const lineIndex = (offendingSymbol?.line ?? 1) - 1;
			const start = offendingSymbol?.startIndex ?? 0;
			const end = (offendingSymbol?.stopIndex ?? 0) + 1;

			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				range: {
					start: Position.create(lineIndex, start),
					end: Position.create(lineIndex, end)
				},
				message: msg
			};
			this.diagnostics.push(diagnostic);
    }
}

export function validateTextDocument(textDocument: TextDocument): Diagnostic[] {
	const lineText: string = textDocument.getText();
	const inputStream = new ANTLRInputStream(lineText);
	const lexer = new CypherLexer(inputStream);
	const tokenStream = new CommonTokenStream(lexer);
	
	const parser = new CypherParser(tokenStream);
	const errorListener = new ErrorListener(textDocument);
	parser.addErrorListener(errorListener);
	const tree = parser.oC_Cypher();

	return errorListener.diagnostics;
}