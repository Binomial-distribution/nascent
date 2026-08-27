from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """运行配置。密钥只从环境变量或 .env 读，不进版本库。"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="NASCENT_")

    debug: bool = False

    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

    # 内容审核开关。默认开着——关掉它是个需要明确动作的决定，
    # 不该因为忘配环境变量而悄悄失效。
    moderation_enabled: bool = True


settings = Settings()
