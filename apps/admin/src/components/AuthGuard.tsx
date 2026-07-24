import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const isAdmin = user?.app_metadata?.is_admin === true || user?.email === "admin@mpchub.top";
      if (user && !isAdmin) {
        supabase.auth.signOut().then(() => setAuthed(false));
      } else {
        setAuthed(Boolean(user && isAdmin));
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      const isAdmin = user?.app_metadata?.is_admin === true || user?.email === "admin@mpchub.top";
      if (user && !isAdmin) {
        supabase.auth.signOut().then(() => setAuthed(false));
      } else {
        setAuthed(Boolean(user && isAdmin));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authed === false) {
      window.location.hash = "#/login";
    }
  }, [authed]);

  if (authed === null || !authed) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        校验管理员权限中...
      </div>
    );
  }

  return <>{children}</>;
}
