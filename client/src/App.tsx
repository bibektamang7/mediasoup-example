import { useState } from "react";
import "./App.css";
import VideoCall from "./components/VideoCall";

function App() {
	const [count, setCount] = useState(0);

	return (
		<>
			<VideoCall />
		</>
	);
}

export default App;
