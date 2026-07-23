import { Component } from 'react';
import { ErrorBox } from './ui.jsx';
import { errorStateFromError, haveResetKeysChanged } from './errorBoundaryState.js';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return errorStateFromError(error);
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary', error, info);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.retry();
    }
  }

  retry() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback({ error: this.state.error, retry: this.retry });
      return <ErrorBox error={this.state.error} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}
