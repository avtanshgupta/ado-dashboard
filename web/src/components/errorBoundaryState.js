export function errorStateFromError(error) {
  return { error };
}

export function haveResetKeysChanged(prevKeys = [], nextKeys = []) {
  return prevKeys.length !== nextKeys.length || prevKeys.some((key, index) => !Object.is(key, nextKeys[index]));
}
