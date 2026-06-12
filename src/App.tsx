import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import ProjectDetail from "@/pages/ProjectDetail";
import ComparePage from "@/pages/ComparePage";
import HealthCheckPage from "@/pages/HealthCheckPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/health" element={<HealthCheckPage />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/project/:id/compare/:compareId" element={<ComparePage />} />
      </Routes>
    </Router>
  );
}
