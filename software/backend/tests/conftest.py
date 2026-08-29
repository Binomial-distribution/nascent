"""Keep unit tests on the local stub. Real SiliconFlow calls stay in manual probes."""

import os

os.environ["NASCENT_LLM_API_KEY"] = ""
os.environ["NASCENT_LLM_BASE_URL"] = ""
os.environ["NASCENT_SPEECH_API_KEY"] = ""
os.environ["NASCENT_SPEECH_BASE_URL"] = ""
os.environ["NASCENT_MINIMAX_API_KEY"] = ""
os.environ["NASCENT_MINIMAX_GROUP_ID"] = ""
os.environ["NASCENT_MIMO_API_KEY"] = ""
