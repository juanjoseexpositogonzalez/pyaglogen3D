function [dfractal,npodf,kf,fun_aprox]=buscafractal2012(dp,dpo,npo,Ap,m,delta)
%funcion que encuentra la dimension fractal buscada utilizando el modelo exponencial;
%utiliza el modelo de kf del paper 2010, con lagunaridad;
%encuentra una solucion, utiliza la menor de las soluciones;
incr=0.00001;dfc=0;kfc=0;caso=0;fun_aprox=0;Apoc=0;
dfmat=1:0.05:3;

% npo=253; delta=1.1;

% Cálculo del prefactor k
gamma=5/4*(1-1/delta)^2/(2-1/delta);

Akf=npo*((3/5*((npo-2)*beta(delta,2)+2*(beta(delta,1)-3/5*alfa(delta,1)*gamma^2))+...
    1/(3*delta^2)*(npo-1)*(npo-2)*(npo-3)*alfa(delta,2)+2*alfa(delta,1)*((npo-1)/delta+3/5*gamma)^2)...
    /((npo-2)*alfa(delta,2)+2*alfa(delta,1)))^(-1/2);

Bkf=(npo*((npo-mu(npo,3))*alfa(delta,6)+6*alfa(delta,3)+mu(npo,9)*alfa(delta,4)))...
    /(3/5*((npo-mu(npo,3))*beta(delta,6)+6*(beta(delta,3)-12/5*alfa(delta,3)*gamma^2)+...
    mu(npo,9)*(beta(delta,4)-9/5*alfa(delta,4)*gamma^2))+alfa(delta,6)/(108*delta^2)*...
    mu(npo,3)*mu(npo,9)*(5*npo-5*mu(npo,3)+1)+2/(3*delta^2)*alfa(delta,3)*(mu(npo,3))^2+...
    alfa(delta,4)/(54*delta^2)*5*mu(npo,3)*mu(npo,9)*mu(npo,21/5));


in=(3/20*npo+1/120*(324*npo^2+343/15)^(1/2))^(1/3)-7/60*(3/20*npo+1/120*(324*npo^2+343/15)^(1/2))^(-1/3)-1/2;

Ckf=(1+10/3*in^3+5*in^2+11/3*in)/((3/5*((10/3*in^3-5*in^2+11/3*in-1)*beta(delta,12)+...
    (24*(in-1))*(beta(delta,7)-27/5*alfa(delta,7)*gamma^2)+12*(beta(delta,5)-(27+12*2^(1/2))/5*alfa(delta,5)*gamma^2)+...
    (4*in^2-12*in+8)*(beta(delta,9)-6/5*alfa(delta,9)*gamma^2)+6*(in-1)^2*(beta(delta,8)-24/5*alfa(delta,8)*gamma^2))+...
    4/delta^2*(alfa(delta,12)*(7/5*in^5-7/2*in^4+4*in^3-5/2*in^2+3/5*in)+12*alfa(delta,5)*in^2+...
    alfa(delta,7)*(20*in^3-24*in^2+4*in)+alfa(delta,9)*(3*in^4-10*in^3+9*in^2-2*in)+...
    alfa(delta,8)*(4*in^4-10*in^3+8*in^2-2*in)))/(alfa(delta,12)/3*(2*in-1)*(5*in^2-5*in+3)+...
    (24*(in-1))*alfa(delta,7)+12*alfa(delta,5)+(4*in^2-12*in+8)*alfa(delta,9)+6*(in-1)^2*alfa(delta,8)))^(3/2);
% Ckf=1.5933*delta/(6-5*delta);0
akf=Akf/2-Bkf+Ckf/2;bkf=-5/2*Akf+4*Bkf-3/2*Ckf;ckf=3*Akf-3*Bkf+Ckf;

% Índice de coordinación J NUEVO
A=1.85; B=0.0191; C=1.45; D=1.5; a=17; b=3.609; c=-0.3901; d=6.2;
%J=2+D*(delta-1)*(Df-1)+(A+(B*(kf^b))+(C*(npo^c)))*10^(-8)*Df^(a+d*(delta-1));

% Cálculo del exp. de solape z
Azp=log(npo)/(log(0.8488*npo+0.1512));Bzp=1.5/(1+0.3005/log(npo));

for idf=1:(size(dfmat,2)-1)
    dfa=dfmat(idf);
    kfa=akf*dfa^2+bkf*dfa+ckf;
    Jfa=2+D*(delta-1)*(dfa-1)+(A+(B*(kfa^b))+(C*(npo^c)))*10^(-8)*dfa^(a+d*(delta-1)); %Nueva salida
    Apoa=1/4*dpo^2*(pi-Jfa*acos(1/delta)+Jfa/delta*sin(acos(1/delta)));
    zpa=Azp-1+(Bzp+1-Azp)^(((dfa-1)/2)^m);
    funa = kfa*(dp/dpo)^dfa-(Ap/Apoa)^zpa;
    
    dfb=dfmat(idf+1); 
    kfb=akf*dfb^2+bkf*dfb+ckf;
    Jfb=2+D*(delta-1)*(dfb-1)+(A+(B*(kfb^b))+(C*(npo^c)))*10^(-8)*dfb^(a+d*(delta-1)); %Nueva salida
    Apob=1/4*dpo^2*(pi-Jfb*acos(1/delta)+Jfb/delta*sin(acos(1/delta)));
    zpb=Azp-1+(Bzp+1-Azp)^(((dfb-1)/2)^m);
    funb = kfb*(dp/dpo)^dfb-(Ap/Apob)^zpb;
    
    if sign(funa)~=sign(funb)
        while abs(dfa-dfb)>incr
            dfc=(dfa+dfb)/2;
            kfc=akf*dfc^2+bkf*dfc+ckf;
            Jfc=2+D*(delta-1)*(dfc-1)+(A+(B*(kfc^b))+(C*(npo^c)))*10^(-8)*dfc^(a+d*(delta-1)); %Nueva salida
            Apoc=1/4*dpo^2*(pi-Jfc*acos(1/delta)+Jfc/delta*sin(acos(1/delta)));
            zpc=Azp-1+(Bzp+1-Azp)^(((dfc-1)/2)^m);
            func = kfc*(dp/dpo)^dfc-(Ap/Apoc)^zpc;
            
            if sign(funa)==sign(func)
                dfa=dfc;funa=func;
            else
                dfb=dfc;funb=func;
            end
        end
    end
    if dfc~=0 
        caso=1;
        break;
    end
end

if dfc==0 && caso==0
    
    kf= @(df) akf*df^2+bkf*df+ckf;
    Jf= @(df) 2+D*(delta-1)*(df-1)+(A+(B*(kf(df)^b))+(C*(npo^c)))*10^(-8)*df^(a+d*(delta-1)); %Nueva salida
    Apo= @(df) 1/4*dpo^2*(pi-Jf(df)*acos(1/delta)+Jf(df)/delta*sin(acos(1/delta)));
    zp= @(df) Azp-1+(Bzp+1-Azp)^(((df-1)/2)^m);
    fun= @(df) abs(kf(df)*(dp/dpo)^df-(Ap/Apo(df))^zp(df));
    dfc=fminbnd(fun,1,3); 
    if dfc>1.001 && dfc<2.999
        kfc=akf*dfc^2+bkf*dfc+ckf;
        Jfc=2+D*(delta-1)*(dfc-1)+(A+(B*(kfc^b))+(C*(npo^c)))*10^(-8)*dfc^(a+d*(delta-1)); %Nueva salida
        Apoc=1/4*dpo^2*(pi-Jfc*acos(1/delta)+Jfc/delta*sin(acos(1/delta)));
        zpc=(Bzp-1)+(Azp+1-Bzp)^(((dfc-1)/2)^m);
        fun_aprox = kfc*(dp/dpo)^dfc-(Ap/Apoc)^zpc;
    else
        dfc=0;
    end
end

dfractal=dfc;
npodf=kfc*(dp/dpo)^dfc;
kf=kfc;
end

function [alfa]=alfa(delta,J)
alfa=1-J/2+J*(3*delta^2-1)/(4*delta^3);
end

function [beta]=beta(delta,J)
beta=(delta^5*(8-4*J)+J*(5*delta^4-1))/(8*delta^5);
end

function [mu]=mu(npo,h)
mu=(12*npo-3)^(1/2)-h;
end