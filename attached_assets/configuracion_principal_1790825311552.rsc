# 2026-09-30 09:45:48 by RouterOS 7.18.2
# software id = C063-D43I
#
# model = RB750Gr3
# serial number = HK70AHCEGMR
/interface bridge
add name=bridge-LAN
/interface ethernet
set [ find default-name=ether1 ] comment=WAN
set [ find default-name=ether2 ] comment=salida
set [ find default-name=ether3 ] comment=salida
set [ find default-name=ether4 ] comment=SALIDA name="ether4 "
set [ find default-name=ether5 ] comment=salida
/ip pool
add name=dhcp_pool0 ranges=192.168.200.10-192.168.200.254
add name=dhcp_pool1 ranges=10.10.10.2-10.10.10.254
/queue simple
add max-limit=500M/500M name=TOTAL target=192.168.200.0/24,10.10.10.0/24
/ip dhcp-server
add address-pool=dhcp_pool0 interface=bridge-LAN lease-time=10m name=dhcp1 \
    parent-queue=TOTAL
/interface bridge port
add bridge=bridge-LAN interface=ether3
add bridge=bridge-LAN interface="ether4 "
add bridge=bridge-LAN interface=ether5
add bridge=bridge-LAN interface=ether2
/ip address
add address=192.168.200.1/24 interface=bridge-LAN network=192.168.200.0
add address=192.168.200.5/24 interface="ether4 " network=192.168.200.0
/ip cloud
set ddns-enabled=yes update-time=no
/ip dhcp-client
add default-route-tables=main interface=ether1
/ip dhcp-server lease
add address=192.168.200.249 address-lists=INTERNET client-id=\
    1:0:e0:20:97:a1:42 comment="ap techo no tocar" insert-queue-before=bottom \
    mac-address=00:E0:20:97:A1:42 parent-queue=TOTAL queue-type=default-small \
    rate-limit=50M/100M server=dhcp1
add address=192.168.200.244 address-lists=INTERNET client-id=\
    1:28:d0:43:6d:bd:38 comment="PC FUTFOL NO TOCAR JONEEE" \
    insert-queue-before=bottom mac-address=28:D0:43:6D:BD:38 parent-queue=\
    TOTAL queue-type=default-small rate-limit=10M/20M server=dhcp1
add address=192.168.200.192 address-lists=INTERNET client-id=\
    1:70:3a:51:3a:c2:c9 comment="JULIO AP" insert-queue-before=bottom \
    mac-address=70:3A:51:3A:C2:C9 parent-queue=TOTAL queue-type=default-small \
    rate-limit=556K/1M server=dhcp1
add address=192.168.200.186 address-lists=INTERNET client-id=\
    1:1a:e9:a1:a0:8b:e5 comment="YULIAN AP" insert-queue-before=bottom \
    mac-address=1A:E9:A1:A0:8B:E5 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.223 address-lists=INTERNET client-id=\
    1:6c:a3:1e:9b:e5:a5 comment="NAIVY AP" insert-queue-before=bottom \
    mac-address=6C:A3:1E:9B:E5:A5 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.207 address-lists=INTERNET client-id=\
    1:68:bf:c4:a6:28:8e comment=BRAYAM insert-queue-before=bottom \
    mac-address=68:BF:C4:A6:28:8E parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.176 address-lists=INTERNET client-id=\
    1:4e:cc:e6:b9:cc:98 comment="carlito techo" insert-queue-before=bottom \
    mac-address=4E:CC:E6:B9:CC:98 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1m/2m server=dhcp1
add address=192.168.200.169 address-lists=INTERNET client-id=\
    1:36:c9:fe:e7:37:3e comment=mari insert-queue-before=bottom mac-address=\
    36:C9:FE:E7:37:3E parent-queue=TOTAL queue-type=default-small rate-limit=\
    564k/1m server=dhcp1
add address=192.168.200.225 address-lists=INTERNET client-id=\
    1:bc:b2:cc:b6:66:2a comment=mairelis insert-queue-before=bottom \
    mac-address=BC:B2:CC:B6:66:2A parent-queue=TOTAL queue-type=default-small \
    rate-limit=1m/2m server=dhcp1
add address=192.168.200.219 address-lists=INTERNET client-id=\
    1:e8:8f:6f:9e:f9:40 comment=nayala insert-queue-before=bottom \
    mac-address=E8:8F:6F:9E:F9:40 parent-queue=TOTAL queue-type=default-small \
    rate-limit=556k/1m server=dhcp1
add address=192.168.200.213 address-lists=INTERNET client-id=\
    1:76:87:5d:84:f5:41 comment=yessica insert-queue-before=bottom \
    mac-address=76:87:5D:84:F5:41 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.210 address-lists=INTERNET client-id=\
    1:e4:84:d3:d:e6:58 comment="mama brayan" insert-queue-before=bottom \
    mac-address=E4:84:D3:0D:E6:58 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.221 address-lists=INTERNET client-id=\
    1:d0:39:fa:a8:e9:dd comment=ruso insert-queue-before=bottom mac-address=\
    D0:39:FA:A8:E9:DD parent-queue=TOTAL queue-type=default-small rate-limit=\
    1M/2M server=dhcp1
add address=192.168.200.163 address-lists=INTERNET client-id=\
    1:b6:ee:b7:d1:9:29 comment=chistian insert-queue-before=bottom \
    mac-address=B6:EE:B7:D1:09:29 parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.162 address-lists=INTERNET client-id=\
    1:3c:13:5a:ce:46:e3 comment=inalbis insert-queue-before=bottom \
    mac-address=3C:13:5A:CE:46:E3 parent-queue=TOTAL queue-type=default-small \
    rate-limit=556k/1M server=dhcp1
add address=192.168.200.154 address-lists=INTERNET client-id=\
    1:f6:4f:ac:bc:a4:c1 comment=alie insert-queue-before=bottom mac-address=\
    F6:4F:AC:BC:A4:C1 parent-queue=TOTAL queue-type=default-small rate-limit=\
    556k/1m server=dhcp1
add address=192.168.200.152 address-lists=INTERNET client-id=\
    1:bc:f7:30:58:b1:ab comment=ISI insert-queue-before=bottom mac-address=\
    BC:F7:30:58:B1:AB parent-queue=TOTAL queue-type=default-small rate-limit=\
    1M/2M server=dhcp1
add address=192.168.200.144 address-lists=INTERNET client-id=\
    1:74:f6:7a:b:21:af comment="papa de marian" insert-queue-before=bottom \
    mac-address=74:F6:7A:0B:21:AF parent-queue=TOTAL queue-type=default-small \
    rate-limit=1M/2M server=dhcp1
add address=192.168.200.135 address-lists=INTERNET client-id=\
    1:da:92:1e:c3:d6:be comment=alberto insert-queue-before=bottom \
    mac-address=DA:92:1E:C3:D6:BE parent-queue=TOTAL queue-type=default-small \
    rate-limit=1m/2m server=dhcp1
add address=192.168.200.149 address-lists=INTERNET client-id=\
    1:80:9f:f5:1c:54:6e comment=tito insert-queue-before=bottom mac-address=\
    80:9F:F5:1C:54:6E parent-queue=TOTAL queue-type=default-small rate-limit=\
    1M/2M server=dhcp1
add address=192.168.200.129 address-lists=INTERNET client-id=\
    1:4e:10:9a:51:24:e1 comment=y insert-queue-before=bottom mac-address=\
    4E:10:9A:51:24:E1 parent-queue=TOTAL queue-type=default-small rate-limit=\
    1M/2M server=dhcp1
add address=192.168.200.107 address-lists=INTERNET client-id=\
    1:58:d6:1f:c:e7:c5 comment=Ap2 insert-queue-before=bottom mac-address=\
    58:D6:1F:0C:E7:C5 parent-queue=TOTAL queue-type=default-small rate-limit=\
    2m/2m server=dhcp1
add address=192.168.200.111 client-id=1:58:d6:1f:c:e7:58 comment=Ap1 \
    mac-address=58:D6:1F:0C:E7:58 parent-queue=TOTAL queue-type=default-small \
    server=dhcp1
add address=192.168.200.114 address-lists=INTERNET client-id=\
    1:fe:95:56:c4:e4:55 comment=yo insert-queue-before=bottom mac-address=\
    FE:95:56:C4:E4:55 parent-queue=TOTAL queue-type=default rate-limit=2M/4M \
    server=dhcp1
add address=192.168.200.98 address-lists=INTERNET client-id=\
    1:80:2a:a8:7c:f0:73 comment="ectico dulcero" insert-queue-before=bottom \
    mac-address=80:2A:A8:7C:F0:73 parent-queue=TOTAL queue-type=default-small \
    rate-limit=3m/6m server=dhcp1
add address=192.168.200.113 address-lists=INTERNET client-id=\
    1:9e:14:98:e6:29:1f comment=ainara insert-queue-before=bottom \
    mac-address=9E:14:98:E6:29:1F parent-queue=none queue-type=default-small \
    rate-limit=1m/2m server=dhcp1
add address=192.168.200.66 address-lists=INTERNET client-id=\
    1:4:f4:1c:df:37:bd comment="Manuel Mk" insert-queue-before=bottom \
    mac-address=04:F4:1C:DF:37:BD parent-queue=TOTAL queue-type=default-small \
    rate-limit=350m/350m server=dhcp1
add address=192.168.200.57 client-id=1:44:d9:e7:4a:23:ba comment="m5  techo" \
    mac-address=44:D9:E7:4A:23:BA server=dhcp1
/ip dhcp-server network
add address=192.168.200.0/24 dns-server=1.1.1.1,8.8.8.8 gateway=192.168.200.1
/ip dns
set allow-remote-requests=yes cache-max-ttl=1d cache-size=8192KiB servers=\
    1.1.1.1,1.0.0.1,8.8.8.8
/ip firewall filter
add action=drop chain=input connection-state=invalid
add action=accept chain=input connection-state=established
add action=drop chain=forward dst-address=192.168.1.1 protocol=tcp
add action=drop chain=input connection-state=invalid
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment=\
    "Mark Source ip port scanner to Address list " protocol=tcp psd=21,3s,3,1
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="NMAP FIN Stealth scan" \
    protocol=tcp tcp-flags=fin,!syn,!rst,!psh,!ack,!urg
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="SYN/FIN scan" protocol=tcp \
    tcp-flags=fin,syn
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="SYN/RST scan" protocol=tcp \
    tcp-flags=syn,rst
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="FIN/PSH/URG scan" protocol=\
    tcp tcp-flags=fin,psh,urg,!syn,!rst,!ack
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="ALL/ALL scan" protocol=tcp \
    tcp-flags=fin,syn,rst,psh,ack,urg
add action=add-src-to-address-list address-list="port scanners" \
    address-list-timeout=2w chain=input comment="NMAP NULL scan" protocol=tcp \
    tcp-flags=!fin,!syn,!rst,!psh,!ack,!urg
add action=drop chain=input comment="Drop port scanners" src-address-list=\
    "port scanners"
/ip firewall mangle
add action=change-mss chain=forward new-mss=clamp-to-pmtu protocol=tcp \
    tcp-flags=syn
/ip firewall nat
add action=masquerade chain=srcnat src-address-list=INTERNET
/ip hotspot profile
set [ find default=yes ] html-directory=hotspot
/ip service
set telnet disabled=yes
set ftp disabled=yes
set www-ssl disabled=no
/system clock
set time-zone-name=America/Denver
/system note
set show-at-login=no
/system ntp client
set enabled=yes
/system ntp client servers
add address=172.233.177.198
