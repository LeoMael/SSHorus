import { useCallback, useEffect, useRef } from "react";

/** Devuelve una función estable que siempre llama a la versión más reciente de `fn`. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
