import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { AgentMessage } from '../types';
import type { Palette } from '../theme';
import { typography } from '../theme';

interface Props {
  message: AgentMessage;
  colors: Palette;
}

function ChatBubbleBase({ message, colors }: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userForeground = colors.background;
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
  const formattedText = useMemo(() => {
    if (msgType === 'file_change') return toCodeBlock(message.text, 'diff');
    return message.text || '';
  }, [message.text, msgType]);
  const shouldRenderMarkdown = !message.streaming;

  const handleLinkPress = (url: string) => {
    Linking.openURL(url).catch(() => {});
    return false;
  };

  if (isUser) {
    return (
      <View style={[styles.row, styles.rowUser]}>
        <View style={styles.bubbleUser}>
          <Markdown style={markdownStylesUser as any} onLinkPress={handleLinkPress}>
            {message.text || ''}
          </Markdown>
        </View>
      </View>
    );
  }

  switch (msgType) {
    case 'thinking':
      return (
        <View style={styles.row}>
          <View style={styles.bubbleThinking}>
            <Text style={styles.typeLabel}>Thinking</Text>
            {shouldRenderMarkdown ? (
              <Markdown style={markdownStylesMuted as any} onLinkPress={handleLinkPress}>
                {formattedText}
              </Markdown>
            ) : (
              <Text style={styles.textThinking}>{message.text}</Text>
            )}
          </View>
        </View>
      );

    case 'command':
      return (
        <View style={styles.row}>
          <View style={styles.terminalLine}>
            <Text style={styles.terminalPrompt}>$</Text>
            <Text style={styles.terminalText} numberOfLines={1}>
              {compactTerminalLine(message.text)}
            </Text>
            {message.streaming && <Text style={styles.terminalCursor}>█</Text>}
          </View>
        </View>
      );

    case 'command_output':
      return (
        <View style={styles.row}>
          <View style={styles.terminalOutput}>
            <Text style={styles.terminalOutputText} numberOfLines={3}>
              {compactTerminalLine(message.text, 220)}
            </Text>
            {message.streaming && <Text style={styles.terminalCursor}>█</Text>}
          </View>
        </View>
      );

    case 'file_change':
      return (
        <View style={styles.row}>
          <View style={styles.bubbleFile}>
            <Text style={styles.typeLabel}>File Change</Text>
            {shouldRenderMarkdown ? (
              <Markdown style={markdownStyles as any} onLinkPress={handleLinkPress}>
                {formattedText}
              </Markdown>
            ) : (
              <Text style={styles.textFile}>{message.text}</Text>
            )}
          </View>
        </View>
      );

    default:
      return (
        <View style={styles.row}>
          <View style={styles.bubbleAgent}>
            {shouldRenderMarkdown ? (
              <Markdown style={markdownStyles as any} onLinkPress={handleLinkPress}>
                {formattedText}
              </Markdown>
            ) : (
              <Text style={styles.textAgent}>{message.text}</Text>
            )}
          </View>
        </View>
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
