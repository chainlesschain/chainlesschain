FROM coturn/coturn:latest

# 复制配置文件
COPY turnserver.conf /etc/coturn/turnserver.conf

# 暴露端口
# 3478: STUN/TURN TCP/UDP
# 5349: STUN/TURN TLS
# 49152-65535: TURN relay ports
EXPOSE 3478 3478/udp
EXPOSE 5349 5349/udp
EXPOSE 49152-65535/udp

# 启动coturn服务器
CMD ["turnserver", "-c", "/etc/coturn/turnserver.conf"]
