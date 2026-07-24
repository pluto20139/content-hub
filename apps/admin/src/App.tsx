import { useState, useEffect } from "react";
import AuthGuard from "./components/AuthGuard";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import UserList from "./pages/UserList";
import MonitorList from "./pages/MonitorList";
import ContentList from "./pages/ContentList";
import Settings from "./pages/Settings";

export default function App() {
  const [route, setRoute] = useState(window.location.hash || "#/dashboard");

  useEffect(() => {
    const onHashChange = () => {
      setRoute(window.location.hash || "#/dashboard");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const hash = route || "#/dashboard";

  if (hash.startsWith("#/login")) {
    return <Login />;
  }

  let pageComponent = <Dashboard />;
  if (hash.startsWith("#/users")) {
    pageComponent = <UserList />;
  } else if (hash.startsWith("#/monitors")) {
    pageComponent = <MonitorList />;
  } else if (hash.startsWith("#/contents")) {
    pageComponent = <ContentList />;
  } else if (hash.startsWith("#/settings")) {
    pageComponent = <Settings />;
  }

  return (
    <AuthGuard>
      <Layout currentHash={hash}>
        {pageComponent}
      </Layout>
    </AuthGuard>
  );
}
