import { ParserRuleContext } from 'antlr4';
import { CodeCompletionCore } from 'antlr4-c3';
import {
  CompletionItem,
  CompletionItemKind,
} from 'vscode-languageserver-types';
import { DbInfo } from '../dbInfo';
import CypherLexer from '../generated-parser/CypherLexer';
import CypherParser, {
  Expression2Context,
  LabelExpression4Context,
  LabelExpression4IsContext,
  NodePatternContext,
  ProcedureNameContext,
  RelationshipPatternContext,
} from '../generated-parser/CypherParser';
import { findParent, findStopNode, isDefined } from '../helpers';
import { CypherTokenType, lexerSymbols, tokenNames } from '../lexerSymbols';
import {
  EnrichedParsingResult,
  parserWrapper,
  ParsingResult,
} from '../parserWrapper';

export function isLabel(p: ParserRuleContext) {
  return (
    p instanceof LabelExpression4Context ||
    p instanceof LabelExpression4IsContext
  );
}

export function inLabel(stopNode: ParserRuleContext) {
  const labelParent = findParent(stopNode, isLabel);

  return isDefined(labelParent);
}

export function inNodeLabel(stopNode: ParserRuleContext) {
  const labelParent = findParent(
    findParent(stopNode, isLabel),
    (p) => p instanceof NodePatternContext,
  );

  return isDefined(labelParent);
}

export function inRelationshipType(stopNode: ParserRuleContext) {
  const relTypeParent = findParent(
    findParent(stopNode, isLabel),
    (p) => p instanceof RelationshipPatternContext,
  );

  return isDefined(relTypeParent);
}

export function parentExpression(stopNode: ParserRuleContext) {
  return findParent(stopNode, (p) => p instanceof Expression2Context);
}

export function inProcedureName(stopNode: ParserRuleContext) {
  const procParent = findParent(
    stopNode,
    (p) => p instanceof ProcedureNameContext,
  );

  return isDefined(procParent);
}

export function autocompleteLabels(dbInfo: DbInfo) {
  return dbInfo.labels.map((t) => {
    return {
      label: t,
      kind: CompletionItemKind.TypeParameter,
    };
  });
}

export function autocompleteRelTypes(dbInfo: DbInfo) {
  return dbInfo.relationshipTypes.map((t) => {
    return {
      label: t,
      kind: CompletionItemKind.TypeParameter,
    };
  });
}

export function autoCompleteFunctions(dbInfo: DbInfo, expr: ParserRuleContext) {
  return Array.from(dbInfo.functionSignatures.keys())
    .filter((functionName) => {
      return functionName.startsWith(expr.getText());
    })
    .map((t) => {
      return {
        label: t,
        kind: CompletionItemKind.Function,
      };
    });
}

export function autoCompleteProcNames(dbInfo: DbInfo) {
  return Array.from(dbInfo.procedureSignatures.keys()).map((t) => {
    return {
      label: t,
      kind: CompletionItemKind.Function,
    };
  });
}

export function autoCompleteStructurally(
  parsingResult: EnrichedParsingResult,
  dbInfo: DbInfo,
): CompletionItem[] | undefined {
  const tokens = parsingResult.tokens;
  const tree = parsingResult.result;
  const lastTokenIndex = tokens.length - 2;
  const lastToken = tokens[lastTokenIndex];
  const eof = tokens[lastTokenIndex + 1];

  if (lastTokenIndex <= 0) {
    return undefined;
    // When we have EOF with a different text in the token,
    // it means the parser has failed to parse it.
    // We give empty completions in that case
    // because the query is severely broken at the
    // point of completion (e.g. an unclosed string)
  } else if (eof.text !== '<EOF>') {
    return [];
  } else if (lastToken.type === CypherParser.SPACE) {
    // If the last token is a space, we surely cannot auto-complete using parsing tree information
    return undefined;
  } else {
    const stopNode = findStopNode(tree);

    if (inRelationshipType(stopNode)) {
      return autocompleteRelTypes(dbInfo);
    } else {
      // Completes expressions that are prefixes of function names as function names
      const expr = parentExpression(stopNode);

      if (isDefined(expr)) {
        return autoCompleteFunctions(dbInfo, expr);
      } else if (inProcedureName(stopNode)) {
        return autoCompleteProcNames(dbInfo);
      } else {
        return undefined;
      }
    }
  }
}

export function autoCompleteStructurallyAddingChar(
  textUntilPosition: string,
  dbInfo: DbInfo,
): CompletionItem[] | undefined {
  // Try adding a filling character, x, at the end
  const parsingResult = parserWrapper.parse(textUntilPosition + 'x');
  const tokens = parsingResult.tokens;
  const tree = parsingResult.result;
  const lastTokenIndex = tokens.length - 2;
  const lastToken = tokens[lastTokenIndex];

  if (lastTokenIndex <= 0) {
    return undefined;
  } else if (lastToken.type === CypherParser.SPACE) {
    // If the last token is a space, we surely cannot auto-complete using parsing tree information
    return undefined;
  } else {
    const stopNode = findStopNode(tree);

    if (inRelationshipType(stopNode)) {
      return autocompleteRelTypes(dbInfo);
    } else {
      return undefined;
    }
  }
}

// labelExpression
// parent relationshipPattern
// prefered rules symbolicLabelNameString
export function completionCoreCompletion(
  parsingResult: ParsingResult,
  dbInfo: DbInfo,
) {
  const parser = parsingResult.parser;
  const tokens = parsingResult.tokens;

  const codeCompletion = new CodeCompletionCore(parser);

  // We always need to subtract one more for the final EOF
  // Except if the query is empty and only contains EOF
  const caretIndex = tokens.length > 1 ? tokens.length - 2 : 0;

  if (caretIndex >= 0) {
    // We need this to ignore the list of tokens from:
    // * unescapedSymbolicNameString, because a lot of keywords are allowed there
    // * escapedSymbolicNameString, to avoid showing ESCAPED_SYMBOLIC_NAME
    // * stringLiteral to avoid getting autocompletions like STRING_LITERAL1, STRING_LITERAL2
    //
    // That way we do not populate tokens that are coming from those rules and those
    // are collected as rule names instead
    codeCompletion.preferredRules = new Set<number>()
      .add(CypherParser.RULE_unescapedSymbolicNameString)
      .add(CypherParser.RULE_escapedSymbolicNameString)
      .add(CypherParser.RULE_stringLiteral)
      .add(CypherParser.RULE_symbolicLabelNameString)
      .add(CypherParser.RULE_symbolicAliasName);

    // Keep only keywords as suggestions
    codeCompletion.ignoredTokens = new Set<number>(
      Object.entries(lexerSymbols)
        .filter(([, type]) => type !== CypherTokenType.keyword)
        .map(([token]) => Number(token)),
    );

    codeCompletion.ignoredTokens.add(CypherParser.EOF);

    const candidates = codeCompletion.collectCandidates(caretIndex);

    const labelCompletions = dbInfo.labels.map((labelName) => ({
      label: labelName,
      kind: CompletionItemKind.TypeParameter,
    }));
    const reltypeCompletions = dbInfo.relationshipTypes.map((relType) => ({
      label: relType,
      kind: CompletionItemKind.TypeParameter,
    }));
    const proceduresCompletions = Array.from(
      dbInfo.procedureSignatures.keys(),
    ).map((procedureName) => ({
      label: procedureName,
      kind: CompletionItemKind.Function,
    }));

    const functionCompletions = Array.from(
      dbInfo.functionSignatures.keys(),
    ).map((functionName) => ({
      label: functionName,
      kind: CompletionItemKind.Function,
    }));
    functionCompletions;

    const ruleCompletions = Array.from(candidates.rules.entries())
      .flatMap((candidate): CompletionItem[] => {
        const [ruleNumber, candidateRule] = candidate;
        if (
          ruleNumber === CypherParser.RULE_unescapedSymbolicNameString ||
          ruleNumber === CypherParser.RULE_symbolicLabelNameString
        ) {
          if (
            candidateRule.ruleList.includes(CypherParser.RULE_procedureName)
          ) {
            return proceduresCompletions;
          }

          if (candidateRule.ruleList.includes(CypherParser.RULE_functionName)) {
            return proceduresCompletions;
          }

          if (
            candidateRule.ruleList.includes(
              CypherParser.RULE_relationshipPattern,
            )
          ) {
            return reltypeCompletions;
          }

          if (candidateRule.ruleList.includes(CypherParser.RULE_nodePattern)) {
            return labelCompletions;
          }

          if (
            candidateRule.ruleList.includes(CypherParser.RULE_labelExpression)
          ) {
            return reltypeCompletions.concat(labelCompletions);
          }
        } else if (ruleNumber === CypherParser.RULE_symbolicAliasName) {
          // The rule for RULE_symbolicAliasName technically allows for spaces given that a dot is included in the name
          // so ALTER ALIAS a . b  FOR DATABASE neo4j is accepted by neo4j. It does however only drop the spaces for the alias
          // it becomes just a.b

          // The issue for us is that when we complete "ALTER ALIAS a " <- according to the grammar points say we could still be building a name
          // To handle this we check if the token after the first identifier in the rule is a space (as opposed to a dot)
          // if so we have a false positive and we return null to ignore the rule
          // symbolicAliasName: (symbolicNameString (DOT symbolicNameString)* | parameter);

          if (
            parsingResult.tokens[candidateRule.startTokenIndex + 1]?.type ===
            CypherLexer.SPACE
          ) {
            return null;
          }

          const rulesCreatingNewAliasOrDb = [
            CypherParser.RULE_createAlias,
            CypherParser.RULE_createDatabase,
            CypherParser.RULE_createCompositeDatabase,
          ];
          // avoid suggesting database names when creating a new alias or database
          if (
            rulesCreatingNewAliasOrDb.some((rule) =>
              candidateRule.ruleList.includes(rule),
            )
          ) {
            return null;
          }

          const rulesThatOnlyAcceptAlias = [
            CypherParser.RULE_dropAlias,
            CypherParser.RULE_alterAlias,
            CypherParser.RULE_showAliases,
          ];
          if (
            rulesThatOnlyAcceptAlias.some((rule) =>
              candidateRule.ruleList.includes(rule),
            )
          ) {
            return dbInfo.aliasNames.map((aliasName) => ({
              label: aliasName,
              kind: CompletionItemKind.Value,
            }));
          }

          // Suggest both database and alias names when it's not alias specific or creating new alias or database
          return dbInfo.databaseNames
            .concat(dbInfo.aliasNames)
            .map((databaseName) => ({
              label: databaseName,
              kind: CompletionItemKind.Value,
            }));
        }
        return null;
      })
      .filter((r) => r !== null);

    const tokens = candidates.tokens.entries();
    const tokenCandidates = Array.from(tokens).flatMap((value) => {
      const [tokenNumber, followUpList] = value;

      const firstToken = tokenNames[tokenNumber];
      const followUpString = followUpList.indexes
        .map((i) => tokenNames[i])
        .join(' ');

      if (firstToken === undefined) {
        return [];
      } else if (followUpString === '') {
        return [firstToken];
      } else {
        const followUp = firstToken + ' ' + followUpString;
        if (followUpList.optional) {
          return [firstToken, followUp];
        }

        return [followUp];
      }
    });

    const tokenCompletions: CompletionItem[] = tokenCandidates.map((t) => ({
      label: t,
      kind: CompletionItemKind.Keyword,
    }));

    return [...ruleCompletions, ...tokenCompletions];
  } else {
    return [];
  }
}