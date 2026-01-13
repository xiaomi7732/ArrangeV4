'use client';

import Image from "next/image";
import styles from "./page.module.css";

import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';

export default function Home() {
  const { instance, accounts, inProgress } = useMsal();
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      console.error('Login failed:', error);
      setError('Login failed. Please try again.');
    }
  };


  const isAuthenticated = accounts.length > 0;
  return (<div>
    {isAuthenticated ? (
      <div>
        Logged in
      </div>) : (
      <div>
        <button disabled={inProgress !== 'none'} onClick={handleLogin}>Login</button>
      </div>)}
  </div>);
}
