import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (authed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        加载中...
      </div>
    );
  }

  if (!authed) {
    window.location.hash = "#/login";
    return null;
  }

  return <>{children}</>;
}
