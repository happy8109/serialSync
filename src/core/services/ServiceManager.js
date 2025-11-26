/**
 * ServiceManager.js
 * 负责服务的注册、生命周期管理和消息分发
 */

class ServiceManager {
    /**
     * @param {PacketScheduler} scheduler 
     */
    constructor(scheduler) {
        this.scheduler = scheduler;
        this.services = []; // 存储所有注册的服务实例
        this.typeMap = new Map(); // type -> service 映射
    }

    /**
     * 注册服务
     * @param {Object} service 
     */
    register(service) {
        // 注入调度器依赖
        if (typeof service.setScheduler === 'function') {
            service.setScheduler(this.scheduler);
        }

        // 注册感兴趣的包类型
        if (typeof service.getInterestedTypes === 'function') {
            const types = service.getInterestedTypes();
            for (const type of types) {
                if (this.typeMap.has(type)) {
                    console.warn(`[ServiceManager] Type 0x${type.toString(16)} is already registered by another service.`);
                }
                this.typeMap.set(type, service);
            }
        }

        this.services.push(service);
    }

    /**
     * 分发接收到的帧
     * @param {Object} frame {type, seq, body}
     */
    handleFrame(frame) {
        const service = this.typeMap.get(frame.type);
        if (service && typeof service.handleFrame === 'function') {
            service.handleFrame(frame);
        } else {
            // console.warn(`[ServiceManager] No service registered for type 0x${frame.type.toString(16)}`);
        }
    }

    /**
     * 启动所有服务
     */
    startAll() {
        for (const service of this.services) {
            if (typeof service.start === 'function') {
                service.start();
            }
        }
    }

    /**
     * 停止所有服务
     */
    stopAll() {
        for (const service of this.services) {
            if (typeof service.stop === 'function') {
                service.stop();
            }
        }
    }
}

module.exports = ServiceManager;
