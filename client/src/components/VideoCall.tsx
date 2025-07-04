import React, { useState, useRef, useCallback } from "react";
import { useMediaSoup } from "../hooks/useMediasoup";

const VideoCall: React.FC = () => {
	const [roomName, setRoomName] = useState("");
	const [isInRoom, setIsInRoom] = useState(false);
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const {
		state,
		isConnected,
		connectToRoom,
		publish,
		getExistingProducers,
		disconnect,
	} = useMediaSoup();

	const handleJoinRoom = useCallback(async () => {
		if (!roomName.trim()) return;

		try {
			await connectToRoom(roomName);
			setIsInRoom(true);

			// Get existing producers
			setTimeout(() => {
				getExistingProducers();
			}, 1000);
		} catch (error) {
			console.error("Error joining room:", error);
		}
	}, [roomName, connectToRoom, getExistingProducers]);

	const handleStartVideo = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: true,
				audio: true,
			});

			if (localVideoRef.current) {
				localVideoRef.current.srcObject = stream;
			}

			await publish(stream);
		} catch (error) {
			console.error("Error starting video:", error);
		}
	}, [publish]);

	const handleLeaveRoom = useCallback(() => {
		disconnect();
		setIsInRoom(false);
		setRoomName("");
		if (localVideoRef.current) {
			localVideoRef.current.srcObject = null;
		}
	}, [disconnect]);

	const RemoteVideo: React.FC<{ stream: MediaStream; id: string }> = ({
		stream,
		id,
	}) => {
		const videoRef = useRef<HTMLVideoElement>(null);

		React.useEffect(() => {
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
			}
		}, [stream]);

		return (
			<div className="remote-video">
				<video
					ref={videoRef}
					autoPlay
					playsInline
					muted={false}
					style={{ width: "300px", height: "200px", border: "1px solid #ccc" }}
				/>
				<p>Remote User: {id}</p>
			</div>
		);
	};

	return (
		<div
			className="video-call-container"
			style={{ padding: "20px" }}
		>
			<h1>MediaSoup Video Call</h1>

			<div className="connection-status">
				Status: {isConnected ? "Connected" : "Disconnected"}
			</div>

			{!isInRoom ? (
				<div className="join-room">
					<input
						type="text"
						placeholder="Enter room name"
						value={roomName}
						onChange={(e) => setRoomName(e.target.value)}
						style={{ padding: "10px", marginRight: "10px" }}
					/>
					<button
						onClick={handleJoinRoom}
						style={{ padding: "10px" }}
					>
						Join Room
					</button>
				</div>
			) : (
				<div className="room-interface">
					<div className="controls">
						<button
							onClick={handleStartVideo}
							disabled={state.isProducer}
						>
							{state.isProducer ? "Video Started" : "Start Video"}
						</button>
						<button
							onClick={handleLeaveRoom}
							style={{ marginLeft: "10px" }}
						>
							Leave Room
						</button>
					</div>

					<div
						className="videos-container"
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "20px",
							marginTop: "20px",
						}}
					>
						<div className="local-video">
							<h3>Local Video</h3>
							<video
								ref={localVideoRef}
								autoPlay
								playsInline
								muted
								style={{
									width: "300px",
									height: "200px",
									border: "1px solid #ccc",
								}}
							/>
						</div>

						<div className="remote-videos">
							<h3>Remote Videos</h3>
							{Array.from(state.remoteStreams.entries()).map(([id, stream]) => (
								<RemoteVideo
									key={id}
									stream={stream}
									id={id}
								/>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default VideoCall;
