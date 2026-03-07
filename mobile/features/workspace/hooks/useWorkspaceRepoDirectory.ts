import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { BridgeResponse } from '../../../types';
import type { RepoEntry, WorkspaceDirectoryEntry } from '../types';

interface Options {
  sendRequest: (action: string, params?: Record<string, unknown>) => Promise<BridgeResponse>;
  mapError: (error: unknown, fallback: string) => string;
  onSelectWorkspaceDirectory: (path: string) => void;
  onSelectAgentDirectory: (path: string) => void;
}

export function useWorkspaceRepoDirectory({
  sendRequest,
  mapError,
  onSelectWorkspaceDirectory,
  onSelectAgentDirectory,
}: Options) {
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [directoryEntries, setDirectoryEntries] = useState<WorkspaceDirectoryEntry[]>([]);
  const [directoryPath, setDirectoryPath] = useState('.');
  const [directoryBaseCwd, setDirectoryBaseCwd] = useState('.');
  const [directoryResolvedCwd, setDirectoryResolvedCwd] = useState('');
  const [directorySelectionTarget, setDirectorySelectionTarget] = useState<'workspace' | 'agent'>('workspace');
  const [loadingDirectories, setLoadingDirectories] = useState(false);

  const [showRepoManager, setShowRepoManager] = useState(false);
  const [repoEntries, setRepoEntries] = useState<RepoEntry[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [cloneRepoUrl, setCloneRepoUrl] = useState('');
  const [cloningRepo, setCloningRepo] = useState(false);

  const loadDirectoryOptions = useCallback(async (targetPath: string, baseCwdOverride?: string) => {
    const browseCwd = baseCwdOverride?.trim() || directoryBaseCwd.trim() || '.';
    setLoadingDirectories(true);
    try {
      const res = await sendRequest('list_directories', {
        cwd: browseCwd,
        path: targetPath,
      });
      if (res.type !== 'response' || !res.data) {
        throw new Error(res.error || 'Failed to list directories');
      }
      const payload = res.data as { entries?: WorkspaceDirectoryEntry[]; cwd?: string; path?: string };
      const responsePath = payload.path || targetPath || '.';
      const baseCwd = payload.cwd || browseCwd;
      const normalizedPath = responsePath === '.' ? '' : responsePath.replace(/^\.\//, '');
      setDirectoryBaseCwd(baseCwd);
      setDirectoryResolvedCwd(normalizedPath ? `${baseCwd.replace(/\/$/, '')}/${normalizedPath}` : baseCwd);
      setDirectoryPath(responsePath);
      setDirectoryEntries(payload.entries || []);
    } catch (error) {
      setDirectoryEntries([]);
      Alert.alert('Browse failed', mapError(error, 'Could not list directories from bridge.'));
    } finally {
      setLoadingDirectories(false);
    }
  }, [directoryBaseCwd, mapError, sendRequest]);

  const openDirectoryPicker = useCallback((cwd: string, target: 'workspace' | 'agent') => {
    const nextBaseCwd = cwd.trim() || '.';
    setDirectorySelectionTarget(target);
    setDirectoryBaseCwd(nextBaseCwd);
    setDirectoryResolvedCwd(nextBaseCwd);
    setShowDirectoryPicker(true);
    void loadDirectoryOptions('.', nextBaseCwd);
  }, [loadDirectoryOptions]);

  const closeDirectoryPicker = useCallback(() => {
    setShowDirectoryPicker(false);
  }, []);

  const navigateDirectoryUp = useCallback(() => {
    if (directoryPath === '.') return;
    const parent = directoryPath.split('/').slice(0, -1).join('/') || '.';
    void loadDirectoryOptions(parent);
  }, [directoryPath, loadDirectoryOptions]);

  const navigateToDirectory = useCallback((path: string) => {
    void loadDirectoryOptions(path);
  }, [loadDirectoryOptions]);

  const confirmDirectorySelection = useCallback(() => {
    const selected = directoryResolvedCwd || directoryBaseCwd;
    if (directorySelectionTarget === 'agent') {
      onSelectAgentDirectory(selected);
    } else {
      onSelectWorkspaceDirectory(selected);
    }
    setShowDirectoryPicker(false);
  }, [
    directoryBaseCwd,
    directoryResolvedCwd,
    directorySelectionTarget,
    onSelectAgentDirectory,
    onSelectWorkspaceDirectory,
  ]);

  const refreshRepoEntries = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await sendRequest('list_repos');
      if (res.type === 'response' && Array.isArray(res.data)) {
        setRepoEntries(res.data as RepoEntry[]);
      } else {
        setRepoEntries([]);
      }
    } catch (error) {
      setRepoEntries([]);
      Alert.alert('Repos failed', mapError(error, 'Could not list repos from bridge.'));
    } finally {
      setLoadingRepos(false);
    }
  }, [mapError, sendRequest]);

  const openRepoManager = useCallback(() => {
    setShowRepoManager(true);
    void refreshRepoEntries();
  }, [refreshRepoEntries]);

  const closeRepoManager = useCallback(() => {
    setShowRepoManager(false);
  }, []);

  const handleCloneRepo = useCallback(async () => {
    const url = cloneRepoUrl.trim();
    if (!url) return;
    setCloningRepo(true);
    try {
      await sendRequest('clone_repo', { url });
      setCloneRepoUrl('');
      await refreshRepoEntries();
    } catch (error) {
      Alert.alert('Clone failed', mapError(error, 'Could not clone repository'));
    } finally {
      setCloningRepo(false);
    }
  }, [cloneRepoUrl, mapError, refreshRepoEntries, sendRequest]);

  const handlePullRepo = useCallback(async (repoPath: string) => {
    try {
      await sendRequest('pull_repo', { path: repoPath });
      await refreshRepoEntries();
    } catch (error) {
      Alert.alert('Pull failed', mapError(error, 'Could not pull repository'));
    }
  }, [mapError, refreshRepoEntries, sendRequest]);

  const useRepoForWorkspace = useCallback((repoPath: string) => {
    onSelectWorkspaceDirectory(repoPath);
    setShowRepoManager(false);
  }, [onSelectWorkspaceDirectory]);

  return {
    showDirectoryPicker,
    directoryEntries,
    directoryPath,
    loadingDirectories,
    openDirectoryPicker,
    closeDirectoryPicker,
    navigateDirectoryUp,
    navigateToDirectory,
    confirmDirectorySelection,
    showRepoManager,
    repoEntries,
    loadingRepos,
    cloneRepoUrl,
    setCloneRepoUrl,
    cloningRepo,
    openRepoManager,
    closeRepoManager,
    refreshRepoEntries,
    handleCloneRepo,
    handlePullRepo,
    useRepoForWorkspace,
  };
}
