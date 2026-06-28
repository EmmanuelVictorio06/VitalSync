import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Role } from '@vitalsync/shared';
import { authService } from '../services/authService';
import { profileService } from '../services/profileService';
import { dbRoleToAppRole } from '../lib/roles';
import type { Profile } from '../services/types';
import type { AuthUser } from '../lib/dto';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** true se o perfil do usuário está entre os informados. */
  hasRole: (...roles: Role[]) => boolean;
  /** Recarrega o perfil do usuário logado e atualiza o contexto (avatar, nome, etc). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Mapeamento papel do banco → enum Role centralizado em lib/roles (D-04).
function toAuthUser(profile: Profile): AuthUser {
  return {
    id: profile.id,
    name: profile.name,
    role: dbRoleToAppRole(profile.role),
    teamId: null,
    avatarUrl: profile.avatar_url ?? null,
    professionalTag: profile.professional_tag ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Carrega o profile a partir do id da sessão (sem chamar getUser dentro do
  // callback de onAuthStateChange — evita deadlock do supabase-js).
  const loadProfileFor = useCallback(async (userId: string) => {
    try {
      const profile = await profileService.getProfile(userId);
      setUser(profile ? toAuthUser(profile) : null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void authService.getSession().then(async (session) => {
      if (session?.user) await loadProfileFor(session.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = authService.onAuthChange((session) => {
      if (session?.user) {
        const uid = session.user.id;
        // Adiar para fora do callback (boa prática do supabase-js).
        setTimeout(() => void loadProfileFor(uid), 0);
      } else {
        setUser(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileFor]);

  const login = useCallback(async (email: string, password: string) => {
    await authService.signIn(email, password);
    const profile = await profileService.getMyProfile();
    if (!profile) throw new Error('Seu perfil não foi encontrado. Contate o administrador.');
    setUser(toAuthUser(profile));
  }, []);

  const logout = useCallback(async () => {
    await authService.signOut();
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const refreshUser = useCallback(async () => {
    const profile = await profileService.getMyProfile();
    if (profile) setUser(toAuthUser(profile));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, hasRole, refreshUser }),
    [user, loading, login, logout, hasRole, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}

export { Role };
