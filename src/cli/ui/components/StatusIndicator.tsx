// @ts-expect-error TS6133/TS6192: Unused variable
import React from "react";
import { StatusBadge } from "./StatusBadge.js";

export const StatusIndicator = ({
	status,
}: {
	status: "success" | "error" | "loading";
}) => {
	if (status === "success") {
		return <StatusBadge compact kind="success" />;
	}
	if (status === "error") {
		return <StatusBadge compact kind="error" />;
	}
	return <StatusBadge compact kind="running" />;
};
