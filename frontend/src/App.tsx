import "./index.css";
import { BrowserRouter as Router, Route, Routes } from "react-router";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { CreateBucketPage } from "./pages/CreateBucketPage";
import { BucketDetailPage } from "./pages/BucketDetailPage";
import { BucketResearchPage } from "./pages/BucketResearchPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { MyBucketsPage } from "./pages/MyBucketsPage";

export function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/create-bucket" element={<CreateBucketPage />} />
        <Route path="/buckets/:id/research" element={<BucketResearchPage />} />
        <Route path="/buckets/:id" element={<BucketDetailPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/my-buckets" element={<MyBucketsPage />} />
      </Routes>
    </Router>
  );
}

export default App;
