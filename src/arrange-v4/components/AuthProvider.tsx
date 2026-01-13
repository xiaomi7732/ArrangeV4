'use client';

import { createContext, useContext, ReactNode } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from '@/lib/msalConfig';

// Create the MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  return (
    <MsalProvider instance={msalInstance}>
      {children}
    </MsalProvider>
  );
}
