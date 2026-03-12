import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../theme';
import type { WorkspaceSearchResult } from '../../features/workspace/types';

interface Props {
  styles: Record<string, any>;
  colors: Palette;
  headerSubtitle: string;
  connectionColor: string;
  statusColor: string;
  metaText: string;
  offlineBannerText?: string | null;
  searchQuery: string;
  searchScope: 'thread' | 'all';
  searchResults: WorkspaceSearchResult[];
  showSearchResults: boolean;
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
  onOpenMoreMenu: () => void;
  onChangeSearchQuery: (value: string) => void;
  onToggleSearchScope: () => void;
  onOpenSearchResult: (result: { threadId: string; timestamp: number; itemId?: string }) => void;
}

export function WorkspaceHeader({
  styles,
  colors,
  headerSubtitle,
  connectionColor,
  statusColor,
  metaText,
  offlineBannerText,
  searchQuery,
  searchScope,
  searchResults,
  showSearchResults,
  onOpenSidebar,
  onOpenSettings,
  onOpenMoreMenu,
  onChangeSearchQuery,
  onToggleSearchScope,
  onOpenSearchResult,
}: Props) {
  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <Pressable style={styles.menuBtn} onPress={onOpenSidebar}>
            <Ionicons name="chatbubbles-outline" size={16} color={colors.background} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Taskdex</Text>
            <Text style={styles.topSub} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>
        </View>
        <View style={styles.topActions}>
          <View style={[styles.connectionDot, { backgroundColor: connectionColor }]} />
          <Pressable onPress={onOpenSettings} style={({ pressed }: { pressed: boolean }) => [styles.headerIconBtn, pressed && styles.pressed]}>
            <Ionicons name="settings-outline" size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={onOpenMoreMenu} style={({ pressed }: { pressed: boolean }) => [styles.headerIconBtn, pressed && styles.pressed]}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={onChangeSearchQuery}
          placeholder={searchScope === 'thread' ? 'Search this thread' : 'Search all threads'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.searchScopeChip} onPress={onToggleSearchScope}>
          <Text style={styles.searchScopeText}>{searchScope === 'thread' ? 'Thread' : 'All'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.metaInline, { color: statusColor }]} numberOfLines={1}>
        {metaText}
      </Text>

      {!!offlineBannerText && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{offlineBannerText}</Text>
        </View>
      )}

      {showSearchResults && (
        <View style={styles.searchResultsPanel}>
          {searchResults.slice(0, 8).map((result, index) => (
            <Pressable
              key={`${result.id || result.threadId}_${result.timestamp}_${index}`}
              style={styles.searchResultRow}
              onPress={() => onOpenSearchResult({
                threadId: result.threadId,
                timestamp: result.timestamp,
                itemId: result.itemId,
              })}
            >
              <Text style={styles.searchResultTitle} numberOfLines={1}>
                {(result.text || '').replace(/\s+/g, ' ').trim() || '(empty message)'}
              </Text>
              <Text style={styles.searchResultMeta} numberOfLines={1}>
                {result.threadId}
              </Text>
            </Pressable>
          ))}
          {searchResults.length === 0 && (
            <Text style={styles.searchEmptyText}>No cross-thread results</Text>
          )}
        </View>
      )}
    </>
  );
}
