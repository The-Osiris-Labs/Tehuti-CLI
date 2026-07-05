import re

with open("src/cli/commands/chat.ts", "r") as f:
    content = f.read()

# 1. loadSessionById
target1 = """					if (data.metadata.model) {
						setCtxModel(resolvedModel);
					}
					setMessages((m) => ["""

replacement1 = """					// Seed context with the loaded historical messages
					ctxRef.current.messages = JSON.parse(JSON.stringify(data.messages));
					
					if (data.metadata.model) {
						setCtxModel(resolvedModel);
					}
					setMessages((m) => ["""

content = content.replace(target1, replacement1)

# 2. continueSession
target2 = """							if (data.metadata.model) {
								setCtxModel(data.metadata.model);
							}
							return;
						}
					}
				}"""

replacement2 = """							if (data.metadata.model) {
								setCtxModel(data.metadata.model);
							}

							// Seed the AgentContext behind the scenes
							ctxRef.current = await createAgentContext(
								process.cwd(),
								{
									...getActiveConfig(),
									provider: nextState.provider,
									baseUrl: nextState.baseUrl,
									apiKey: nextState.apiKey,
									customProvider:
										nextState.provider === "custom" &&
										nextState.customProvider?.baseUrl
											? nextState.customProvider
											: undefined,
									model: data.metadata.model || ctxModel,
									maxIterations: 50,
									maxTokens: 4096,
									permissions: {
										defaultMode: "trust",
										alwaysAllow: [],
										alwaysDeny: [],
										trustedMode: true,
									},
								},
								diffPreview,
							);
							ctxRef.current.messages = JSON.parse(JSON.stringify(data.messages));
							
							return;
						}
					}
				}"""

content = content.replace(target2, replacement2)

# 3. scrollIndicator
target3_regex = r"const scrollIndicator = useMemo\(\(\) => \{[\s\S]*?\}, \[totalMessageLines, chatViewportHeight, scrollOffset\]\);"
replacement3 = "const scrollIndicator = null;"

content = re.sub(target3_regex, replacement3, content)

with open("src/cli/commands/chat.ts", "w") as f:
    f.write(content)

