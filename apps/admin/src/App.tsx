import { useState, useEffect } from "react";
import AuthGuard from "./components/AuthGuard";
import Login from "./pages/Login";
import MonitorList from "./pages/MonitorList";

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const hash = route.slice(1) || "";

  if (hash.startsWith("/login")) {
    return <Login />;
  }

  return (
    <AuthGuard>
      <MonitorList />
    </AuthGuard>
  );
}
