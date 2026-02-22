import React, { memo, useMemo, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Linking, Pressable, Animated } from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import SyntaxHighlighter from 'react-native-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/styles/hljs';
import type { AgentMessage } from '../types';
import type { Palette } from '../theme';
import { typography } from '../theme';

interface Props {
  message: AgentMessage;
  colors: Palette;
  onFilePress?: (path: string) => void;
}

function ChatBubbleBase({ message, colors, onFilePress }: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const motion = useRef(new Animated.Value(0)).current;
  const userForeground = colors.background;
  const syntaxTheme = useMemo(
    () => (isDarkPalette(colors) ? atomOneDark : atomOneLight),
    [colors],
  );
  const markdownRules = useMemo(
    () => createMarkdownRules(styles, syntaxTheme),
    [styles, syntaxTheme],
  );
  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);
  const markdownStylesMuted = useMemo(
    () => ({ ...createMarkdownStyles(colors), body: { color: colors.textSecondary } }),
    [colors],
  );
  const markdownStylesUser = useMemo(
    () => ({
      ...createMarkdownStyles(colors),
      body: { color: userForeground },
      paragraph: {
        color: userForeground,
        fontSize: 15,
        lineHeight: 21,
        marginTop: 0,
        marginBottom: 0,
        fontFamily: typography.medium,
      },
      heading1: { color: userForeground, fontSize: 22, marginTop: 0, marginBottom: 8, fontFamily: typography.display },
      heading2: { color: userForeground, fontSize: 19, marginTop: 0, marginBottom: 7, fontFamily: typography.display },
      heading3: { color: userForeground, fontSize: 17, marginTop: 0, marginBottom: 6, fontFamily: typography.semibold },
      blockquote: { borderLeftColor: userForeground, backgroundColor: colors.surfaceSubtle },
      link: { color: userForeground },
      code_inline: { color: userForeground, backgroundColor: colors.surfaceSubtle },
      code_block: { color: userForeground, backgroundColor: colors.surfaceSubtle },
      fence: { color: userForeground, backgroundColor: colors.surfaceSubtle },
      bullet_list_icon: { color: userForeground },
      ordered_list_icon: { color: userForeground },
      hr: { backgroundColor: colors.surfaceSubtle },
    }),
    [colors, userForeground],
  );

  const isUser = message.role === 'user';
  const msgType = message.type || (isUser ? 'user' : 'agent');
  const outputLines = useMemo(() => (message.text || '').split('\n'), [message.text]);
  const collapsedOutputText = useMemo(
    () => outputLines.slice(0, 5).join('\n'),
    [outputLines],
  );
  const hasCollapsedOutput = outputLines.length > 5;
  const formattedText = useMemo(() => {
    if (msgType === 'file_change') return toCodeBlock(message.text, 'diff');
    return message.text || '';
  }, [message.text, msgType]);
  const filePath = useMemo(
    () => (msgType === 'file_change' ? extractLikelyFilePath(message.text) : null),
    [message.text, msgType],
  );
  const shouldRenderMarkdown = !message.streaming;
  const animatedStyle = useMemo(
    () => ({
      opacity: motion,
      transform: [{
        translateY: motion.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      }],
    }),
    [motion],
  );

  useEffect(() => {
    Animated.timing(motion, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [motion]);

  const withMotion = (content: React.ReactNode) => (
    <Animated.View style={animatedStyle}>
      {content}
    </Animated.View>
  );

  const handleLinkPress = (url: string) => {
    Linking.openURL(url).catch(() => {});
    return false;
  };

  if (isUser) {
    return withMotion(
      <View style={[styles.row, styles.rowUser]}>
        <View style={styles.bubbleUser}>
          <Markdown style={markdownStylesUser as any} onLinkPress={handleLinkPress}>
            {message.text || ''}
          </Markdown>
        </View>
      </View>,
    );
  }

  switch (msgType) {
    case 'thinking':
      return withMotion(
        <View style={styles.row}>
          <View style={styles.bubbleThinking}>
            <Text style={styles.typeLabel}>Thinking</Text>
            {!thinkingExpanded ? (
              <Pressable style={styles.collapseHeader} onPress={() => setThinkingExpanded(true)}>
                <Text style={styles.collapseHint}>Show</Text>
                <Text style={styles.textThinking} numberOfLines={2}>
                  {compactTerminalLine(message.text, 160)}
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.collapseHeader} onPress={() => setThinkingExpanded(false)}>
                  <Text style={styles.collapseHint}>Hide</Text>
                </Pressable>
                {shouldRenderMarkdown ? (
                  <Markdown style={markdownStylesMuted as any} onLinkPress={handleLinkPress} rules={markdownRules as any}>
                    {formattedText}
                  </Markdown>
                ) : (
                  <Text style={styles.textThinking}>{message.text}</Text>
                )}
              </>
            )}
          </View>
        </View>,
      );

    case 'command':
      return withMotion(
        <View style={styles.row}>
          <View style={styles.terminalLine}>
            <Text style={styles.terminalPrompt}>$</Text>
            <Text style={styles.terminalText} numberOfLines={1}>
              {compactTerminalLine(message.text)}
            </Text>
            {message.streaming && <Text style={styles.terminalCursor}>█</Text>}
          </View>
        </View>,
      );

    case 'command_output':
      return withMotion(
        <View style={styles.row}>
          <View style={styles.terminalOutput}>
            <Text style={styles.terminalOutputText}>
              {(outputExpanded || !hasCollapsedOutput || message.streaming) ? message.text : collapsedOutputText}
            </Text>
            {hasCollapsedOutput && !message.streaming && (
              <Pressable onPress={() => setOutputExpanded((value) => !value)}>
                <Text style={styles.collapseHint}>{outputExpanded ? 'Show less' : 'Show more'}</Text>
              </Pressable>
            )}
            {message.streaming && <Text style={styles.terminalCursor}>█</Text>}
          </View>
        </View>,
      );

    case 'file_change':
      return withMotion(
        <View style={styles.row}>
          <View style={styles.bubbleFile}>
            <Text style={styles.typeLabel}>File Change</Text>
            {shouldRenderMarkdown ? (
              <Markdown style={markdownStyles as any} onLinkPress={handleLinkPress} rules={markdownRules as any}>
                {formattedText}
              </Markdown>
            ) : (
              <Text style={styles.textFile}>{message.text}</Text>
            )}
            {filePath && onFilePress && (
              <Pressable style={styles.fileActionButton} onPress={() => onFilePress(filePath)}>
                <Text style={styles.fileActionText}>Open file</Text>
              </Pressable>
            )}
          </View>
        </View>,
      );

    default:
      return withMotion(
        <View style={styles.row}>
          <View style={styles.bubbleAgent}>
            {shouldRenderMarkdown ? (
              <Markdown style={markdownStyles as any} onLinkPress={handleLinkPress} rules={markdownRules as any}>
                {formattedText}
              </Markdown>
            ) : (
              <Text style={styles.textAgent}>{message.text}</Text>
            )}
          </View>
        </View>,
      );
  }
}

export const ChatBubble = memo(
  ChatBubbleBase,
  (prev, next) => prev.message === next.message && prev.colors === next.colors,
);

function toCodeBlock(text: string, language: string) {
  const trimmed = (text || '').trimEnd();
  if (!trimmed) return '';
  if (trimmed.includes('```')) return trimmed;
  return `\`\`\`${language}\n${trimmed}\n\`\`\``;
}

function compactTerminalLine(text: string, max = 120) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function extractLikelyFilePath(text: string): string | null {
  const candidate = (text || '').split('\n')[0]?.trim();
  if (!candidate) return null;
  if (candidate.includes('/') || candidate.includes('\\')) return candidate;
  if (candidate.includes('.')) return candidate;
  return null;
}

function extractFenceLanguage(node: any): string {
  const raw = typeof node?.sourceInfo === 'string'
    ? node.sourceInfo
    : typeof node?.info === 'string'
      ? node.info
      : '';
  const language = raw.trim().split(/\s+/)[0]?.toLowerCase();
  return language || 'text';
}

function extractFenceContent(node: any): string {
  if (typeof node?.content === 'string') return node.content;
  if (typeof node?.children?.[0]?.content === 'string') return node.children[0].content;
  return '';
}

function isDarkPalette(colors: Palette): boolean {
  const c = colors.background.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance < 140;
}

function createMarkdownRules(styles: ReturnType<typeof createStyles>, syntaxTheme: Record<string, unknown>) {
  return {
    fence: (node: any) => {
      const language = extractFenceLanguage(node);
      const content = extractFenceContent(node);
      return (
        <View key={node.key} style={styles.codeBlockShell}>
          <View style={styles.codeHeader}>
            <Text style={styles.codeHeaderText}>{language}</Text>
            <Pressable
              style={styles.codeCopyButton}
              onPress={() => {
                void Clipboard.setStringAsync(content);
              }}
            >
              <Text style={styles.codeCopyText}>Copy</Text>
            </Pressable>
          </View>
          <SyntaxHighlighter
            highlighter="hljs"
            language={language}
            style={syntaxTheme as any}
            fontFamily={typography.mono}
            fontSize={12}
          >
            {content}
          </SyntaxHighlighter>
        </View>
      );
    },
  };
}

const createStyles = (colors: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: 11,
    paddingHorizontal: 16,
  },
  rowUser: {
    justifyContent: 'flex-end',
  },

  // User
  bubbleUser: {
    maxWidth: '82%',
    backgroundColor: colors.accent,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textUser: {
    color: colors.background,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: typography.medium,
  },

  // Agent message
  bubbleAgent: {
    maxWidth: '85%',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingLeft: 0,
    paddingRight: 16,
    paddingVertical: 12,
  },
  textAgent: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.regular,
  },

  // Thinking
  bubbleThinking: {
    maxWidth: '85%',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textThinking: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
    fontFamily: typography.medium,
  },

  // Command
  bubbleCommand: {
    maxWidth: '90%',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textCommand: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.mono,
  },

  // Command output
  bubbleOutput: {
    maxWidth: '90%',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textOutput: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.mono,
  },

  // File change
  bubbleFile: {
    maxWidth: '90%',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textFile: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.mono,
  },

  // Type label
  typeLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  terminalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '92%',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 6,
  },
  terminalPrompt: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.mono,
  },
  terminalText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.mono,
  },
  terminalOutput: {
    maxWidth: '92%',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  terminalOutputText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.mono,
  },
  terminalCursor: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.mono,
  },
  collapseHeader: {
    marginBottom: 4,
    gap: 4,
  },
  collapseHint: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: typography.semibold,
  },
  codeBlockShell: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
    marginVertical: 6,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  codeHeaderText: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    fontFamily: typography.semibold,
    letterSpacing: 0.6,
  },
  codeCopyButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeCopyText: {
    color: colors.accent,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
  fileActionButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  fileActionText: {
    color: colors.accent,
    fontSize: 11,
    fontFamily: typography.semibold,
  },
});

const createMarkdownStyles = (colors: Palette) => ({
  body: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.regular,
  },
  paragraph: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 0,
    marginBottom: 2,
    fontFamily: typography.regular,
  },
  heading1: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 0,
    marginBottom: 8,
    fontFamily: typography.display,
  },
  heading2: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 0,
    marginBottom: 7,
    fontFamily: typography.display,
  },
  heading3: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 23,
    marginTop: 0,
    marginBottom: 6,
    fontFamily: typography.semibold,
  },
  heading4: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 0,
    marginBottom: 6,
    fontFamily: typography.semibold,
  },
  heading5: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 0,
    marginBottom: 6,
    fontFamily: typography.semibold,
  },
  heading6: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 0,
    marginBottom: 6,
    fontFamily: typography.semibold,
  },
  bullet_list_icon: {
    color: colors.textPrimary,
    marginRight: 6,
  },
  bullet_list_content: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.regular,
  },
  ordered_list_icon: {
    color: colors.textPrimary,
    marginRight: 6,
  },
  ordered_list_content: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.regular,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 6,
    borderRadius: 8,
  },
  code_inline: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
    fontSize: 13,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    fontFamily: typography.mono,
  },
  code_block: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.mono,
  },
  fence: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.mono,
  },
  link: {
    color: colors.accent,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 6,
  },
  th: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: typography.semibold,
    fontSize: 12,
  },
  td: {
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: typography.regular,
    fontSize: 12,
  },
});
