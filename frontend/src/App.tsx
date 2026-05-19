import "./index.css";
import { BrowserRouter as Router, Route, Routes } from "react-router";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { CreateBucketPage } from "./pages/CreateBucketPage";
import { BucketDetailPage } from "./pages/BucketDetailPage";
import { BucketResearchPage } from "./pages/BucketResearchPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { MyBucketsPage } from "./pages/MyBucketsPage";
import { DesktopOnly } from "./components/DesktopOnly";
import { NotFoundPage } from "./pages/NotFoundPage";

function DesktopRoute({ children }: { children: React.ReactNode }) {
  return <DesktopOnly>{children}</DesktopOnly>;
}

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/dashboard"
          element={
            <DesktopRoute>
              <Dashboard />
            </DesktopRoute>
          }
        />
        <Route
          path="/create-bucket"
          element={
            <DesktopRoute>
              <CreateBucketPage />
            </DesktopRoute>
          }
        />
        <Route
          path="/buckets/:id/research"
          element={
            <DesktopRoute>
              <BucketResearchPage />
            </DesktopRoute>
          }
        />
        <Route
          path="/buckets/:id"
          element={
            <DesktopRoute>
              <BucketDetailPage />
            </DesktopRoute>
          }
        />
        <Route
          path="/portfolio"
          element={
            <DesktopRoute>
              <PortfolioPage />
            </DesktopRoute>
          }
        />
        <Route
          path="/my-buckets"
          element={
            <DesktopRoute>
              <MyBucketsPage />
            </DesktopRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}

export default App;
