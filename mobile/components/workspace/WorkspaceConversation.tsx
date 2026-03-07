import React from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TypingIndicator } from '../TypingIndicator';
import type { AgentMessage } from '../../types';
import type { Palette } from '../../theme';

interface Props {
  styles: Record<string, any>;
  colors: Palette;
  listRef: React.RefObject<FlatList<AgentMessage> | null>;
  hasActiveAgent: boolean;
  isThreadHydrating: boolean;
  hasAnyMessages: boolean;
  isAgentWorking: boolean;
  typingLabel: string;
  visibleMessages: AgentMessage[];
  loadingMoreMessages: boolean;
  activityCount: number;
  showActivity: boolean;
  renderChatItem: ({ item }: { item: AgentMessage }) => React.ReactElement;
  keyExtractor: (item: AgentMessage) => string;
  onToggleActivity: () => void;
  onContentSizeChange: () => void;
  onScroll: (event: any) => void;
  onScrollToIndexFailed: (info: any) => void;
  showScrollToBottom: boolean;
  bottomInset: number;
  onScrollToBottom: () => void;
}

export function WorkspaceConversation({
  styles,
  colors,
  listRef,
  hasActiveAgent,
  isThreadHydrating,
  hasAnyMessages,
  isAgentWorking,
  typingLabel,
  visibleMessages,
  loadingMoreMessages,
  activityCount,
  showActivity,
  renderChatItem,
  keyExtractor,
  onToggleActivity,
  onContentSizeChange,
  onScroll,
  onScrollToIndexFailed,
  showScrollToBottom,
  bottomInset,
  onScrollToBottom,
}: Props) {
  return (
    <>
      <View style={styles.chatPanel}>
        {!hasActiveAgent ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Thread Selected</Text>
              <Text style={styles.emptySub}>Create an agent, then start a thread.</Text>
            </View>
          </View>
        ) : isThreadHydrating ? (
          <View style={styles.skeletonWrap}>
            <View style={styles.skeletonBubbleWide} />
            <View style={styles.skeletonBubbleMid} />
            <View style={styles.skeletonBubbleShort} />
          </View>
        ) : !hasAnyMessages && isAgentWorking ? (
          <View style={styles.emptyWrap}>
            <TypingIndicator label={typingLabel} colors={colors} />
          </View>
        ) : !hasAnyMessages ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Start Chatting</Text>
              <Text style={styles.emptySub}>Each thread keeps its own context.</Text>
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={keyExtractor}
            renderItem={renderChatItem}
            getItemLayout={(_, index) => ({ length: 104, offset: 104 * index, index })}
            ListHeaderComponent={loadingMoreMessages || activityCount > 0 ? (
              <View>
                {loadingMoreMessages && (
                  <View style={styles.paginationLoadingWrap}>
                    <Text style={styles.paginationLoadingText}>Loading older messages...</Text>
                  </View>
                )}
                {activityCount > 0 && (
                  <View style={styles.thinkingToggleWrap}>
                    <Pressable style={styles.thinkingToggleBtn} onPress={onToggleActivity}>
                      <Ionicons
                        name={showActivity ? 'chevron-down' : 'chevron-forward'}
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.thinkingToggleText}>
                        {showActivity ? `Hide activity (${activityCount})` : `Show activity (${activityCount})`}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
            ListEmptyComponent={!showActivity && activityCount > 0 ? (
              <View style={styles.thinkingCollapsedEmpty}>
                <Text style={styles.thinkingCollapsedTitle}>Activity is collapsed</Text>
                <Text style={styles.thinkingCollapsedSub}>Expand to inspect thinking, commands, and outputs.</Text>
              </View>
            ) : null}
            ListFooterComponent={isAgentWorking ? <TypingIndicator label={typingLabel} colors={colors} /> : null}
            contentContainerStyle={styles.chatListContent}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            windowSize={9}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={32}
            removeClippedSubviews={true}
            scrollEventThrottle={16}
            onScrollToIndexFailed={onScrollToIndexFailed}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {showScrollToBottom && hasActiveAgent && (
        <Pressable
          style={[styles.scrollToBottomBtn, { bottom: bottomInset + 70 }]}
          onPress={onScrollToBottom}
        >
          <Ionicons name="chevron-down" size={18} color={colors.background} />
        </Pressable>
      )}
    </>
  );
}
