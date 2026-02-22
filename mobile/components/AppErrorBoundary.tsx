import React from 'react';
import { SafeAreaView, View, Text, Pressable, StyleSheet } from 'react-native';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[app-error-boundary]', error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. You can try reloading the screen.
          </Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#101010',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  card: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#303030',
    backgroundColor: '#171717',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 10,
  },
  title: {
    color: '#F2F2F2',
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    color: '#CCCCCC',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
});
