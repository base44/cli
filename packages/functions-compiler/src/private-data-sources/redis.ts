import { buildIoredisConnectorFactory } from "./ioredis-adapter";
import { privateDataSourceReference } from "./manifest";
import { authenticateRedisSocketIfNeeded } from "./redis-auth";
import { buildTcpPrivateDataSource } from "./tcp";

export function redis(name: unknown) {
  const source = buildTcpPrivateDataSource(
    privateDataSourceReference(name, "redis"),
  ) as ReturnType<typeof buildTcpPrivateDataSource> & {
    connect: (options?: unknown) => unknown;
  };
  const { connect: _connect, ...descriptors } =
    Object.getOwnPropertyDescriptors(source);
  const extension = {
    connect(options?: unknown) {
      return authenticateRedisSocketIfNeeded(
        source.connect(options),
        source.username,
        source.password,
      );
    },
    ioredisConnector() {
      return buildIoredisConnectorFactory(() =>
        authenticateRedisSocketIfNeeded(
          source.connect(),
          source.username,
          source.password,
        ),
      );
    },
    ioredisOptions() {
      return Object.freeze({
        Connector: buildIoredisConnectorFactory(() => source.connect()),
        ...(source.password && source.username
          ? { username: source.username }
          : {}),
        ...(source.password ? { password: source.password } : {}),
      });
    },
  };
  return Object.freeze(
    Object.defineProperties(
      extension,
      descriptors,
    ) as typeof source & typeof extension,
  );
}
