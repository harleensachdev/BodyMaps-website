import { BrowserRouter, Route, Routes } from "react-router";
import "./App.css";
import { default as RotatingHeartLoader } from "./components/Loading";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { FileProvider } from "./contexts/fileContexts";
import VisualizationPage from "./routes/VisualizationPage";

const BASENAME = import.meta.env.VITE_BASENAME;

function App() {
	return (
		<>
			<FileProvider>
				<AnnotationProvider>
				<div className="App">
					<BrowserRouter basename={BASENAME}>
						<Routes>
							{/* <Route path="/" element={<Homepage />} />
							<Route path="/home" element={<Homepage2 />} /> */}
							{/* <Route path="/data" element={<DataPage />} /> */}
							{/* <Route path="/:type/:page" element={<Homepage />} /> */}
							<Route path="/case/:caseId" element={<VisualizationPage />} />
							<Route path="/test" element={<RotatingHeartLoader />} />
						</Routes>
					</BrowserRouter>
				</div>
				</AnnotationProvider>
			</FileProvider>
		</>
	);
}	

export default App;
