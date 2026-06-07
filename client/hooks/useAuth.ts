import { useState, useEffect } from 'react';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Replace with real auth check
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated };
}
