import Sidebar from "./Sidebar";

interface Props {
  currentHash: string;
  children: React.ReactNode;
}

export default function Layout({ currentHash, children }: Props) {
  return (
    <div className="flex min-h-screen bg-gray-100/60 font-sans">
      <Sidebar currentHash={currentHash} />
      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}
