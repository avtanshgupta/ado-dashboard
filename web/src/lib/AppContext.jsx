import { createContext, useContext } from 'react';

export const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);
export const useConfig = () => useContext(AppContext)?.config;
